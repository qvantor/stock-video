import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import type { ExportSettings, PlatformValidation } from '@dfs/contracts';
import {
  buildCsv,
  slugify,
  validationOf,
  type CsvClip,
  type StockCsvAdapter,
} from '@dfs/stock-csv';
import { hashOf } from './hash.js';
import { frameFile } from './steps/frames.js';
import type { ClipRecord } from './types.js';

export interface ArchiveClip {
  record: ClipRecord;
  /** Final delivery file name. */
  filename: string;
  originalFilename: string;
}

export interface BuildArchiveInput {
  projectName: string;
  clips: ArchiveClip[];
  excludedCount: number;
  adapters: StockCsvAdapter[];
  settings: ExportSettings;
  exportsRoot: string;
  clipDir: (jobId: string, clipId: string) => string;
  now: Date;
  /** The last build; reused when nothing changed. */
  previous: { hash: string | null; dir: string | null; zip: string | null } | null;
}

export interface BuildArchiveResult {
  dir: string;
  zip: string;
  zipSizeBytes: number;
  reportMd: string;
  hash: string;
  reused: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;

const exists = (p: string | null) =>
  p
    ? fs.access(p).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);

export const csvClipOf = (c: ArchiveClip): CsvClip => {
  const { metadata, tech } = c.record;
  if (!metadata || !tech) throw new Error(`Clip ${c.filename} has no metadata`);
  return {
    filename: c.filename,
    metadata,
    editorial: c.record.editorial ?? metadata.editorialSuggested,
    geo: c.record.geo,
    tech,
    outputSizeBytes: c.record.outputSizeBytes,
  };
};

/** Hash of everything that ends up in the archive (no LLM or cutting is involved in a rebuild). */
export const archiveHash = (
  input: Pick<BuildArchiveInput, 'projectName' | 'clips' | 'adapters' | 'settings'>,
): string =>
  hashOf(
    'archive.v1',
    input.projectName,
    input.clips.map((c) => ({
      id: c.record.id,
      filename: c.filename,
      cut: c.record.stepHashes.cut,
      size: c.record.outputSizeBytes,
      metadata: c.record.metadata,
      editorial: c.record.editorial,
      frames: c.record.stepHashes.frames,
      geo: c.record.geo,
      tech: c.record.tech,
    })),
    input.adapters.map((a) => [a.id, a.lastVerified, a.header]),
    {
      adobeAuthor: input.settings.adobeAuthor,
      copyright: input.settings.copyright,
      pond5Price: input.settings.pond5Price,
      pond5PriceLarge: input.settings.pond5PriceLarge,
      envatoPriceSingle: input.settings.envatoPriceSingle,
      envatoPriceMulti: input.settings.envatoPriceMulti,
    },
  );

const linkOrCopy = async (src: string, dest: string) => {
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
};

/**
 * Builds `export_{project}_{yyyymmdd_hhmm}/` (videos, previews, csv, metadata.json, report.md) and a
 * streamed ZIP64 next to it (videos stored, everything else deflated). The folder layout and file
 * names can be uploaded via FTP as they are.
 */
export const buildArchive = async (input: BuildArchiveInput): Promise<BuildArchiveResult> => {
  const hash = archiveHash(input);
  const prev = input.previous;
  if (
    prev?.hash === hash &&
    prev.dir &&
    prev.zip &&
    (await exists(prev.dir)) &&
    (await exists(prev.zip))
  ) {
    const { size } = await fs.stat(prev.zip);
    const reportMd = await fs.readFile(path.join(prev.dir, 'report.md'), 'utf8');
    return { dir: prev.dir, zip: prev.zip, zipSizeBytes: size, reportMd, hash, reused: true };
  }

  const name = `export_${slugify(input.projectName) || 'project'}_${stamp(input.now)}`;
  const dir = path.join(input.exportsRoot, name);
  const zip = path.join(input.exportsRoot, `${name}.zip`);
  await fs.rm(dir, { recursive: true, force: true });
  for (const sub of ['videos', 'previews', 'csv'])
    await fs.mkdir(path.join(dir, sub), { recursive: true });

  const ctx = { settings: input.settings, exportDate: input.now };
  const csvClips = input.clips.map(csvClipOf);
  const validations = new Map<string, PlatformValidation[]>();
  for (const adapter of input.adapters) {
    const file = buildCsv(adapter, csvClips, ctx);
    await fs.writeFile(path.join(dir, 'csv', file.fileName), file.content, 'utf8');
    for (const [filename, issues] of file.issues) {
      validations.set(filename, [
        ...(validations.get(filename) ?? []),
        validationOf(adapter.id, issues),
      ]);
    }
  }

  const previews = new Map<string, string[]>();
  for (const c of input.clips) {
    if (!c.record.cutPath) throw new Error(`Clip ${c.filename} has not been cut`);
    await linkOrCopy(c.record.cutPath, path.join(dir, 'videos', c.filename));
    const base = c.filename.replace(/\.[^.]+$/, '');
    const names: string[] = [];
    for (const f of c.record.frames ?? []) {
      const previewName = `${base}_${f.index + 1}.jpg`;
      await fs.copyFile(
        path.join(input.clipDir(c.record.jobId, c.record.id), frameFile(f.index, 'full')),
        path.join(dir, 'previews', previewName),
      );
      names.push(previewName);
    }
    previews.set(c.filename, names);
  }

  const metadata = {
    project: input.projectName,
    builtAt: input.now.toISOString(),
    platforms: input.adapters.map((a) => ({
      id: a.id,
      label: a.label,
      lastVerified: a.lastVerified,
      verified: a.verified,
    })),
    clips: input.clips.map((c) => ({
      filename: c.filename,
      clipId: c.record.id,
      source: {
        videoId: c.record.videoId,
        originalFilename: c.originalFilename,
        segmentId: c.record.segmentId,
        startSec: c.record.startSec,
        endSec: c.record.endSec,
        startFrame: c.record.startFrame,
        endFrame: c.record.endFrame,
      },
      previews: previews.get(c.filename) ?? [],
      context: { frames: c.record.frames, geo: c.record.geo, tech: c.record.tech },
      generation: c.record.generation,
      userHint: c.record.userHint,
      poiOverride: c.record.poiOverride,
      final: {
        ...c.record.metadata,
        editorial: c.record.editorial ?? c.record.metadata?.editorialSuggested ?? false,
      },
      outputSizeBytes: c.record.outputSizeBytes,
      validations: validations.get(c.filename) ?? [],
    })),
  };
  await fs.writeFile(path.join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  const reportMd = renderReport(input, validations, name);
  await fs.writeFile(path.join(dir, 'report.md'), reportMd);

  await writeZip(dir, name, zip);
  if (prev?.dir && prev.dir !== dir) await fs.rm(prev.dir, { recursive: true, force: true });
  if (prev?.zip && prev.zip !== zip) await fs.rm(prev.zip, { force: true });
  const { size } = await fs.stat(zip);
  return { dir, zip, zipSizeBytes: size, reportMd, hash, reused: false };
};

const writeZip = async (dir: string, rootName: string, zip: string): Promise<void> => {
  const part = `${zip}.part`;
  const output = createWriteStream(part);
  const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
  });
  archive.pipe(output);
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) await walk(relPath);
      else {
        const zipEntry: archiver.ZipEntryData = {
          name: path.posix.join(rootName, relPath),
          // Video is already compressed: store it (fast, no gain from deflate).
          store: relPath.startsWith('videos/'),
        };
        archive.file(path.join(dir, relPath), zipEntry);
      }
    }
  };
  await walk('');
  await archive.finalize();
  await done;
  await fs.rename(part, zip);
};

const LEVEL_ICON: Record<PlatformValidation['level'], string> = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
};

export const renderReport = (
  input: Pick<BuildArchiveInput, 'projectName' | 'clips' | 'excludedCount' | 'adapters' | 'now'>,
  validations: Map<string, PlatformValidation[]>,
  folderName: string,
): string => {
  const lines: string[] = [];
  const total = input.clips.reduce((n, c) => n + (c.record.outputSizeBytes ?? 0), 0);
  const duration = input.clips.reduce((n, c) => n + (c.record.tech?.durationSec ?? 0), 0);
  lines.push(`# Export report: ${input.projectName}`, '');
  lines.push(`- Folder: \`${folderName}\``);
  lines.push(`- Built: ${input.now.toISOString()}`);
  lines.push(`- Clips: ${input.clips.length} (excluded by the user: ${input.excludedCount})`);
  lines.push(
    `- Total duration: ${duration.toFixed(1)} s, total size: ${(total / 1024 ** 3).toFixed(2)} GB`,
    '',
  );

  lines.push(
    '## Platforms',
    '',
    '| Platform | OK | Warnings | Errors | Template verified |',
    '|---|---|---|---|---|',
  );
  for (const a of input.adapters) {
    const levels = input.clips.map(
      (c) => validations.get(c.filename)?.find((v) => v.platform === a.id)?.level ?? 'ok',
    );
    const count = (l: string) => levels.filter((x) => x === l).length;
    lines.push(
      `| ${a.label} | ${count('ok')} | ${count('warning')} | ${count('error')} | ${a.verified ? 'yes' : 'no'} (checked ${a.lastVerified}) |`,
    );
  }
  lines.push('');

  const withIssues = input.clips.filter((c) =>
    (validations.get(c.filename) ?? []).some((v) => v.level !== 'ok'),
  );
  lines.push('## Platform warnings and errors', '');
  if (!withIssues.length) lines.push('None.', '');
  for (const c of withIssues) {
    lines.push(`### ${c.filename}`, '');
    for (const v of validations.get(c.filename) ?? []) {
      if (v.level === 'ok') continue;
      const label = input.adapters.find((a) => a.id === v.platform)?.label ?? v.platform;
      for (const m of v.messages) lines.push(`- **${label}** (${LEVEL_ICON[v.level]}): ${m}`);
    }
    lines.push('');
  }

  const uncertain = input.clips.filter((c) =>
    ['low', 'unknown'].includes(c.record.metadata?.placeConfidence ?? 'unknown'),
  );
  lines.push('## Place confidence low or unknown', '');
  if (!uncertain.length) lines.push('None.');
  for (const c of uncertain) {
    const place =
      [c.record.geo?.city, c.record.geo?.country].filter(Boolean).join(', ') || 'no location';
    lines.push(`- ${c.filename}: ${c.record.metadata?.placeConfidence ?? 'unknown'} (${place})`);
  }
  lines.push('');

  const editorial = input.clips.filter(
    (c) => c.record.metadata?.editorialSuggested || c.record.editorial,
  );
  lines.push('## Editorial', '');
  if (!editorial.length) lines.push('None.');
  for (const c of editorial) {
    const final = c.record.editorial ?? c.record.metadata?.editorialSuggested ?? false;
    const reason = c.record.metadata?.editorialReason ?? 'set by the user';
    lines.push(
      `- ${c.filename}: ${final ? 'editorial' : 'commercial (model suggested editorial)'}. ${reason}`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
};
