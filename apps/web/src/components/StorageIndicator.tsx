import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { STORAGE_CATEGORIES, type StorageCategory } from '@dfs/contracts';
import { useStorageCleanup, useStorageUsage } from '../api/storage';
import { formatBytes } from '../lib/format';

const CATEGORY: Record<StorageCategory, { label: string; color: string }> = {
  sources: { label: 'Source videos', color: 'bg-sky-500' },
  proxies: { label: 'Proxies & thumbnails', color: 'bg-indigo-400' },
  analysis: { label: 'Analysis cache', color: 'bg-violet-400' },
  encodedClips: { label: 'Encoded clips', color: 'bg-amber-500' },
  archives: { label: 'Export archives', color: 'bg-orange-400' },
  frames: { label: 'Preview frames', color: 'bg-teal-400' },
  aiLogs: { label: 'AI responses', color: 'bg-emerald-400' },
  uploads: { label: 'Unfinished uploads', color: 'bg-neutral-400' },
  database: { label: 'Database', color: 'bg-lime-400' },
  other: { label: 'Other', color: 'bg-neutral-600' },
};

const CONFIRM_TEXT =
  'Delete encoded clips and export archives?\n\n' +
  'Metadata and AI responses are kept. Clips can be encoded again from the export page.';

/** Disk usage by data type and project, with a button that frees rebuildable files. */
export const StorageIndicator = () => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { data, error } = useStorageUsage(open);
  const cleanup = useStorageCleanup();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onCleanup = () => {
    if (window.confirm(CONFIRM_TEXT)) cleanup.mutate();
  };

  const categories = data
    ? STORAGE_CATEGORIES.filter((c) => data.byCategory[c] > 0).sort(
        (a, b) => data.byCategory[b] - data.byCategory[a],
      )
    : [];
  const rows = data
    ? [
        ...data.projects,
        ...(data.unassigned.totalBytes > 0
          ? [{ id: '', name: 'Not in any project', ...data.unassigned }]
          : []),
      ]
    : [];

  return (
    <div ref={root} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Storage usage"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
          <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
          <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
        </svg>
        {data ? formatBytes(data.totalBytes) : '…'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Storage"
          className="absolute top-full right-0 z-20 mt-2 w-96 rounded-lg border border-neutral-800 bg-neutral-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
        >
          {error && <p className="text-sm text-red-400">{error.message}</p>}
          {!data && !error && <p className="text-sm text-neutral-400">Measuring…</p>}
          {data && (
            <>
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-medium text-neutral-100">
                  {formatBytes(data.totalBytes)} used
                </span>
                {data.freeBytes !== null && (
                  <span className="text-xs text-neutral-500">
                    {formatBytes(data.freeBytes)} free on disk
                  </span>
                )}
              </div>

              {data.totalBytes > 0 && (
                <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-neutral-800">
                  {categories.map((c) => (
                    <div
                      key={c}
                      className={CATEGORY[c].color}
                      style={{ width: `${(data.byCategory[c] / data.totalBytes) * 100}%` }}
                    />
                  ))}
                </div>
              )}

              <ul className="mb-3 space-y-1">
                {categories.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-xs">
                    <span className={clsx('h-2 w-2 shrink-0 rounded-sm', CATEGORY[c].color)} />
                    <span className="flex-1 text-neutral-300">{CATEGORY[c].label}</span>
                    <span className="text-neutral-400 tabular-nums">
                      {formatBytes(data.byCategory[c])}
                    </span>
                  </li>
                ))}
              </ul>

              {rows.length > 0 && (
                <table className="mb-3 w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="pb-1 text-left font-normal">Project</th>
                      <th className="pb-1 text-right font-normal">Used</th>
                      <th className="pb-1 text-right font-normal">Can free</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-t border-neutral-800">
                        <td
                          className={clsx(
                            'max-w-0 truncate py-1 pr-2',
                            p.id ? 'text-neutral-200' : 'text-neutral-500 italic',
                          )}
                          title={p.name}
                        >
                          {p.name}
                        </td>
                        <td className="py-1 text-right text-neutral-300 tabular-nums">
                          {formatBytes(p.totalBytes)}
                        </td>
                        <td className="py-1 pl-2 text-right text-neutral-500 tabular-nums">
                          {p.reclaimableBytes > 0 ? formatBytes(p.reclaimableBytes) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <button
                type="button"
                onClick={onCleanup}
                disabled={data.reclaimableBytes === 0 || cleanup.isPending}
                className="w-full rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {cleanup.isPending
                  ? 'Cleaning up…'
                  : data.reclaimableBytes > 0
                    ? `Free up ${formatBytes(data.reclaimableBytes)}`
                    : 'Nothing to clean up'}
              </button>
              <p className="mt-1.5 text-xs text-neutral-500">
                Deletes encoded clips and export archives. Sources, metadata and AI responses are
                kept.
              </p>
              {cleanup.error && (
                <p className="mt-1.5 text-xs text-red-400">{cleanup.error.message}</p>
              )}
              {cleanup.data && (
                <p className="mt-1.5 text-xs text-emerald-400">
                  Freed {formatBytes(cleanup.data.freedBytes)}
                  {cleanup.data.clipsReset > 0 &&
                    ` · ${cleanup.data.clipsReset} clips are waiting for encoding`}
                  {cleanup.data.skipped.length > 0 && (
                    <span className="block text-amber-400">
                      Skipped {cleanup.data.skipped.length} project(s) with an archive being built.
                    </span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
