import type { ExportJob } from '@dfs/contracts';
import { formatBytes } from '../../lib/format';

/** Result of the last archive build: download link, folder and the report. */
export const ArchivePanel = ({ job }: { job: ExportJob }) => {
  if (job.buildStatus === 'building') {
    return (
      <section className="rounded-lg border border-sky-800 bg-sky-950/30 p-4 text-sm text-sky-200">
        Building the archive… (copying clips, writing CSVs and the ZIP)
      </section>
    );
  }
  if (job.buildStatus === 'failed') {
    return (
      <section className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">
        Archive build failed: {job.buildError}
      </section>
    );
  }
  if (!job.archive) return null;
  const a = job.archive;
  return (
    <section className="space-y-3 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={a.zipUrl}
          download
          className="rounded bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500"
        >
          Download ZIP ({formatBytes(a.zipSizeBytes)})
        </a>
        <span className="text-neutral-400">
          {a.clipCount} clips · built {new Date(a.builtAt).toLocaleString()}
        </span>
      </div>
      <p>
        Folder: <code className="select-all break-all text-emerald-300">{a.folderPath}</code>
      </p>
      <details>
        <summary className="cursor-pointer text-neutral-300">report.md</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-3 text-xs text-neutral-300">
          {a.reportMd}
        </pre>
      </details>
    </section>
  );
};
