import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Link, useParams } from 'react-router-dom';
import type { ExportClip } from '@dfs/contracts';
import {
  useBuildArchive,
  useExportHealth,
  useExportState,
  useRegenerateAll,
  useStartExport,
  useStockCategories,
  useStockPlatforms,
} from '../api/export';
import { useProject } from '../api/projects';
import { useVideos } from '../api/videos';
import { ArchivePanel } from '../components/export/ArchivePanel';
import { BulkActions } from '../components/export/BulkActions';
import { ClipDrawer } from '../components/export/ClipDrawer';
import {
  clipStatusLabel,
  clipStatusTone,
  isAwaitingCut,
  SHOT_LABEL,
} from '../components/export/labels';
import { PlatformBadges } from '../components/export/PlatformBadges';
import { VideoLocations } from '../components/export/VideoLocations';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { formatDuration } from '../lib/format';

const ACTIVE = new Set(['frames', 'geo', 'tech', 'llm', 'cut']);

const placeOf = (c: ExportClip) => {
  const g = c.context.geo;
  if (!g) return '—';
  return [g.city, g.country].filter(Boolean).join(', ') || g.manualText || 'unknown';
};

export const ExportPage = () => {
  const { projectId = '' } = useParams();
  useProjectEvents(projectId);
  const { data: project } = useProject(projectId);
  const { data: state, error, isLoading } = useExportState(projectId);
  const { data: videos } = useVideos(projectId);
  const { data: health } = useExportHealth();
  const { data: platforms } = useStockPlatforms();
  const { data: categories } = useStockCategories();
  const start = useStartExport(projectId);
  const build = useBuildArchive(projectId);
  const regenerateAll = useRegenerateAll(projectId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const clips = useMemo(() => state?.clips ?? [], [state]);
  const open = clips.find((c) => c.id === openId);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (error) return <div className="p-8 text-red-400">{error.message}</div>;
  if (isLoading || !project) return <div className="p-8 text-neutral-500">Loading…</div>;

  const job = state?.job;
  const counts = job?.counts;
  const awaitingCut = clips.filter(isAwaitingCut).length;
  const onRegenerateAll = () => {
    const ok = window.confirm(
      'Regenerate all clips from scratch?\n\n' +
        'All metadata edits, approvals, exclusions and the archive will be lost.',
    );
    if (ok) regenerateAll.mutate();
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-neutral-800 bg-neutral-950/90 px-6 py-3 backdrop-blur">
        <Link to={`/projects/${projectId}`} className="text-neutral-400 hover:text-neutral-100">
          ← {project.name}
        </Link>
        <h1 className="flex-1 text-lg font-semibold text-neutral-100">Export</h1>
        <Link
          to="/settings/export"
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
        >
          Export settings
        </Link>
        {job && (
          <button
            onClick={onRegenerateAll}
            disabled={regenerateAll.isPending || job.buildStatus === 'building'}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-40"
          >
            {regenerateAll.isPending ? 'Regenerating…' : 'Regenerate all'}
          </button>
        )}
        {job && awaitingCut > 0 && counts?.cut === 0 && project.status === 'confirmed' && (
          <button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            title="Encode approved clips whose files were removed to free up space"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Encode {awaitingCut} approved {awaitingCut === 1 ? 'clip' : 'clips'}
          </button>
        )}
        {job && (
          <button
            onClick={() => build.mutate()}
            disabled={!job.canBuild || build.isPending}
            title={job.canBuild ? undefined : 'Every clip must be done or excluded'}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {job.buildStatus === 'building' ? 'Building…' : 'Build archive'}
          </button>
        )}
      </header>

      <div className="mx-auto max-w-7xl space-y-4 p-6">
        {health && !health.ok && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
            <strong>Ollama is not ready.</strong> {health.message}
            {health.message?.includes('ollama pull') ? null : (
              <span>
                {' '}
                Then install the model:{' '}
                <code className="select-all">ollama pull {health.model}</code>
              </span>
            )}
          </div>
        )}
        {build.error && <p className="text-sm text-red-400">{build.error.message}</p>}
        {state && start.error && <p className="text-sm text-red-400">{start.error.message}</p>}
        {regenerateAll.error && (
          <p className="text-sm text-red-400">{regenerateAll.error.message}</p>
        )}

        {!state ? (
          <div className="rounded-lg border border-neutral-800 p-6 text-sm">
            {project.status === 'confirmed' ? (
              <>
                <p className="mb-3 text-neutral-300">
                  The export has not been started for this project yet.
                </p>
                <button
                  onClick={() => start.mutate()}
                  disabled={start.isPending}
                  className="rounded bg-sky-600 px-4 py-1.5 text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  Start export
                </button>
                {start.error && <p className="mt-2 text-red-400">{start.error.message}</p>}
              </>
            ) : (
              <p className="text-neutral-400">Confirm the segments first.</p>
            )}
          </div>
        ) : (
          <>
            {job && counts && (
              <section className="rounded-lg border border-neutral-800 p-4">
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="text-neutral-100">
                    {job.total - job.excluded} clips
                    {job.excluded ? ` (+${job.excluded} excluded)` : ''}
                  </span>
                  <span className="text-emerald-400">done {counts.done}</span>
                  <span className="text-amber-300">review {counts.review - awaitingCut}</span>
                  <span className="text-sky-300">
                    processing{' '}
                    {awaitingCut +
                      counts.queued +
                      counts.frames +
                      counts.geo +
                      counts.tech +
                      counts.llm +
                      counts.cut}
                  </span>
                  {counts.failed > 0 && (
                    <span className="text-red-400">failed {counts.failed}</span>
                  )}
                  <span className="tabular ml-auto text-neutral-400">
                    {Math.round(job.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-800">
                  <div
                    className="h-1.5 rounded-full bg-sky-500 transition-[width]"
                    style={{ width: `${job.progress * 100}%` }}
                  />
                </div>
              </section>
            )}
            {job && <ArchivePanel job={job} />}
            {state.videos.length > 0 && (
              <VideoLocations projectId={projectId} videos={state.videos} />
            )}
            <BulkActions projectId={projectId} clips={clips} selected={selected} />

            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={clips.length > 0 && selected.size === clips.length}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? new Set(clips.map((c) => c.id)) : new Set(),
                          )
                        }
                        className="accent-sky-500"
                      />
                    </th>
                    <th className="px-2 py-2">Preview</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Place</th>
                    <th className="px-2 py-2">Shot</th>
                    <th className="px-2 py-2">Title</th>
                    <th className="px-2 py-2 text-right">Tags</th>
                    <th className="px-2 py-2">Platforms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {clips.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setOpenId(c.id)}
                      className={clsx(
                        'cursor-pointer hover:bg-neutral-900',
                        c.excluded && 'opacity-40',
                      )}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select clip ${c.ordinal + 1}`}
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          className="accent-sky-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        {c.context.frames?.[0] ? (
                          <img
                            src={c.context.frames[0].url}
                            alt=""
                            className="h-12 w-[86px] rounded object-cover"
                          />
                        ) : (
                          <div className="h-12 w-[86px] rounded bg-neutral-800" />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div
                          className={clsx('text-xs', clipStatusTone(c))}
                          title={c.error ?? undefined}
                        >
                          {clipStatusLabel(c)}
                          {ACTIVE.has(c.status) &&
                            c.progress > 0 &&
                            ` · ${Math.round(c.progress * 100)}%`}
                        </div>
                        <div className="tabular text-[11px] text-neutral-500">
                          #{c.ordinal + 1} · {formatDuration(c.endSec - c.startSec)}
                        </div>
                      </td>
                      <td
                        className="max-w-[160px] truncate px-2 py-2 text-xs text-neutral-300"
                        title={c.context.geo?.displayName ?? undefined}
                      >
                        {placeOf(c)}
                      </td>
                      <td className="px-2 py-2 text-xs text-neutral-400">
                        {c.context.tech ? SHOT_LABEL[c.context.tech.shotType] : '—'}
                      </td>
                      <td className="max-w-[340px] px-2 py-2">
                        <div className="truncate text-neutral-100" title={c.metadata?.title}>
                          {c.metadata?.title ?? <span className="text-neutral-600">—</span>}
                        </div>
                        {c.filename && (
                          <div className="truncate text-[11px] text-neutral-500">{c.filename}</div>
                        )}
                      </td>
                      <td className="tabular px-2 py-2 text-right text-xs">
                        <span
                          className={clsx(
                            (c.metadata?.keywords.length ?? 0) > 50
                              ? 'text-red-400'
                              : 'text-neutral-300',
                          )}
                        >
                          {c.metadata?.keywords.length ?? '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <PlatformBadges validations={c.validations} platforms={platforms} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {open && (
        <ClipDrawer
          key={open.id}
          projectId={projectId}
          clip={open}
          video={videos?.find((v) => v.id === open.videoId)}
          categories={categories}
          platforms={platforms}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};
