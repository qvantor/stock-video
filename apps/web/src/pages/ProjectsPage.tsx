import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  isVideoSettled,
  type ProjectListItem,
  type ProjectOverview,
  type VideoStatus,
} from '@dfs/contracts';
import { useCreateProject, useProjects } from '../api/projects';
import { SpriteThumb } from '../components/SpriteThumb';
import { StorageIndicator } from '../components/StorageIndicator';
import { SystemStatusDot } from '../components/SystemStatusDot';
import { STATUS_LABEL } from '../components/StageProgress';

const PREVIEW_W = 220;
const PREVIEW_H = 124;
const PREVIEW_GAP = 2;
const CELL_W = (PREVIEW_W - PREVIEW_GAP) / 2;
const CELL_H = (PREVIEW_H - PREVIEW_GAP) / 2;

/** Grid spans of each tile so that 1–4 previews always fill the whole 2×2 box. */
const SPANS: Record<number, { cols: number; rows: number }[]> = {
  1: [{ cols: 2, rows: 2 }],
  2: [
    { cols: 1, rows: 2 },
    { cols: 1, rows: 2 },
  ],
  3: [
    { cols: 1, rows: 2 },
    { cols: 1, rows: 1 },
    { cols: 1, rows: 1 },
  ],
};

/** Up to four video frames in a fixed 2×2 box; videos beyond them show as +N on the last tile. */
const ProjectPreview = ({ overview: o }: { overview: ProjectOverview }) => {
  const previews = o.previews.slice(0, 4);
  const hidden = o.videoCount - previews.length;
  if (previews.length === 0)
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded bg-neutral-800 text-xs text-neutral-500"
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
      >
        no videos
      </div>
    );
  return (
    <div
      className="grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded bg-neutral-800"
      style={{ width: PREVIEW_W, height: PREVIEW_H, gap: PREVIEW_GAP }}
    >
      {previews.map((p, i) => {
        const span = SPANS[previews.length]?.[i] ?? { cols: 1, rows: 1 };
        const last = i === previews.length - 1;
        return (
          <div
            key={p.videoId}
            className="relative overflow-hidden"
            style={{ gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}` }}
          >
            <SpriteThumb
              spriteUrl={p.spriteUrl}
              meta={p.spriteMeta}
              index={Math.floor(p.spriteMeta.count / 3)}
              width={span.cols === 2 ? PREVIEW_W : CELL_W}
              height={span.rows === 2 ? PREVIEW_H : CELL_H}
            />
            {last && hidden > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-neutral-100">
                +{hidden}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ProjectRow = ({ project }: { project: ProjectListItem }) => {
  const o = project.overview;
  const counts = Object.entries(o.statusCounts) as [VideoStatus, number][];
  const processing = counts.filter(([s]) => !isVideoSettled(s));
  const processingCount = processing.reduce((sum, [, n]) => sum + n, 0);
  return (
    <Link to={`/projects/${project.id}`} className="flex gap-4 px-4 py-3 hover:bg-neutral-900">
      <ProjectPreview overview={o} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-neutral-100">{project.name}</span>
          <span className="shrink-0 text-xs text-neutral-500">
            {new Date(project.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="tabular flex flex-wrap gap-x-3 text-xs text-neutral-400">
          <span>{plural(o.videoCount, 'video')}</span>
          <span>
            {plural(o.segmentCount, 'segment')}
            {o.segmentCount > 0 && `, ${o.acceptedSegments} accepted`}
          </span>
          {o.statusCounts.ready ? (
            <span>
              {o.reviewedCount} of {o.statusCounts.ready} checked
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {project.status === 'confirmed' ? (
            <span className="rounded bg-emerald-900/60 px-1.5 text-emerald-300">✓ Confirmed</span>
          ) : (
            <span className="rounded bg-neutral-800 px-1.5 text-neutral-300">Draft</span>
          )}
          {o.statusCounts.ready ? (
            <span className="rounded bg-neutral-800 px-1.5 text-emerald-400">
              {o.statusCounts.ready} ready
            </span>
          ) : null}
          {processingCount > 0 && (
            <span
              className="rounded bg-neutral-800 px-1.5 text-sky-400"
              title={processing.map(([s, n]) => `${STATUS_LABEL[s]}: ${n}`).join('\n')}
            >
              {processingCount} processing
            </span>
          )}
          {o.statusCounts.failed ? (
            <span className="rounded bg-neutral-800 px-1.5 text-red-400">
              {o.statusCounts.failed} failed
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
};

export const ProjectsPage = () => {
  const { data: projects, isLoading, error } = useProjects();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: (p) => navigate(`/projects/${p.id}`),
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-100">Projects</h1>
        <div className="flex items-center gap-3">
          <StorageIndicator />
          <SystemStatusDot />
          <Link to="/settings/export" className="text-sm text-neutral-400 hover:text-neutral-100">
            Export settings
          </Link>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mb-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name, e.g. “Altai, September”"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          Create
        </button>
      </form>
      {create.error && <p className="mb-4 text-red-400">{create.error.message}</p>}
      {isLoading && <p className="text-neutral-500">Loading…</p>}
      {error && <p className="text-red-400">Failed to load projects: {error.message}</p>}
      <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {projects?.map((p) => (
          <li key={p.id}>
            <ProjectRow project={p} />
          </li>
        ))}
        {projects?.length === 0 && (
          <li className="px-4 py-6 text-center text-neutral-500">No projects yet</li>
        )}
      </ul>
    </div>
  );
};
