import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@dfs/contracts';
import { useConfirmProject } from '../api/projects';
import { formatDuration } from '../lib/format';

interface Props {
  projectId: string;
  summary: ProjectSummary;
  onClose: () => void;
}

export const ConfirmDialog = ({ projectId, summary, onClose }: Props) => {
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useConfirmProject(projectId);
  const navigate = useNavigate();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const blocked = summary.issueCount > 0;
  const videosInManifest = summary.readyCount;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[480px] rounded-xl border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 backdrop:bg-black/70"
    >
      <div className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-neutral-100">Confirm segments</h2>
        {confirm.data ? (
          <div className="space-y-3 text-sm">
            <p className="text-emerald-400">
              Done. The export pipeline has started: frames, location, metadata and cutting run in
              the background.
            </p>
            <p>
              Manifest:{' '}
              <code className="select-all break-all text-emerald-300">
                {confirm.data.manifestPath}
              </code>
            </p>
          </div>
        ) : (
          <>
            <dl className="tabular mb-4 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-neutral-400">Videos</dt>
              <dd>{videosInManifest}</dd>
              <dt className="text-neutral-400">Accepted segments</dt>
              <dd>{summary.acceptedSegments}</dd>
              <dt className="text-neutral-400">Total duration</dt>
              <dd>{formatDuration(summary.acceptedDurationSec)}</dd>
              {summary.failedCount > 0 && (
                <>
                  <dt className="text-amber-400">Failed videos (excluded)</dt>
                  <dd className="text-amber-400">{summary.failedCount}</dd>
                </>
              )}
            </dl>
            {blocked && (
              <div className="mb-4 rounded border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-300">
                There are invalid accepted segments ({summary.issueCount}): too short/long or
                overlapping. Fix them in the editor or reject them.
              </div>
            )}
            {summary.blockers.filter((b) => !b.startsWith('Invalid segments')).length > 0 && (
              <ul className="mb-4 list-inside list-disc text-sm text-amber-300">
                {summary.blockers
                  .filter((b) => !b.startsWith('Invalid segments'))
                  .map((b) => (
                    <li key={b}>{b}</li>
                  ))}
              </ul>
            )}
            <p className="mb-4 text-xs text-neutral-500">
              After confirmation the project becomes read-only.
            </p>
            {confirm.error && <p className="mb-3 text-sm text-red-400">{confirm.error.message}</p>}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => ref.current?.close()}
            className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            {confirm.data ? 'Close' : 'Cancel'}
          </button>
          {confirm.data && (
            <button
              onClick={() => navigate(`/projects/${projectId}/export`)}
              className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Open export
            </button>
          )}
          {!confirm.data && (
            <button
              disabled={!summary.canConfirm || confirm.isPending}
              onClick={() => confirm.mutate()}
              className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {confirm.isPending ? 'Confirming…' : 'Confirm'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
};
