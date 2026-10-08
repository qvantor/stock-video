import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ExistingVideoInfo } from '@dfs/contracts';
import { formatBytes, formatDuration } from '../lib/format';
import { useUploadStore, type LocalUpload } from '../uploads/uploadStore';

const DASH = '—';

const fmtFps = (fps: number | null) => (fps === null ? DASH : fps.toFixed(2).replace(/\.?0+$/, ''));
const fmtResolution = (v: ExistingVideoInfo) =>
  v.width !== null && v.height !== null ? `${v.width}×${v.height}` : DASH;
/** Camera time is often local wall-clock written as UTC: show it as written. */
const fmtCaptureTime = (iso: string | null) => (iso ? iso.slice(0, 19).replace('T', ' ') : DASH);

const Comparison = ({ upload, projectName }: { upload: LocalUpload; projectName: string }) => {
  const existing = upload.duplicates ?? [];
  const rows: Array<[string, ReactNode, (v: ExistingVideoInfo) => ReactNode]> = [
    ['File', upload.filename, (v) => v.originalFilename],
    [
      'Project',
      projectName,
      (v) => (
        <Link
          to={`/projects/${v.projectId}`}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 hover:underline"
        >
          {v.projectName}
        </Link>
      ),
    ],
    [
      'Duration',
      upload.durationSec !== undefined ? formatDuration(upload.durationSec) : DASH,
      (v) => (v.durationSec !== null ? formatDuration(v.durationSec) : DASH),
    ],
    ['Size', formatBytes(upload.size), (v) => formatBytes(v.sizeBytes)],
    ['Resolution', DASH, fmtResolution],
    ['Frame rate', DASH, (v) => fmtFps(v.fps)],
    ['Codec', DASH, (v) => (v.codec ? v.codec.toUpperCase() : DASH)],
    ['Captured', DASH, (v) => fmtCaptureTime(v.creationTime)],
    ['Uploaded', DASH, (v) => new Date(v.createdAt).toLocaleString()],
  ];
  return (
    <table className="tabular w-full table-fixed text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-neutral-500">
          <th className="w-28 py-1 font-normal" />
          <th className="py-1 font-normal">New file</th>
          {existing.map((v, i) => (
            <th key={v.videoId} className="py-1 font-normal">
              Existing video{existing.length > 1 ? ` ${i + 1}` : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, mine, theirs]) => (
          <tr key={label} className="border-t border-neutral-800">
            <td className="py-1 text-neutral-400">{label}</td>
            <td className="truncate py-1 pr-2">{mine}</td>
            {existing.map((v) => (
              <td key={v.videoId} className="truncate py-1 pr-2">
                {theirs(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Asks what to do with dropped files that are already stored in some project. */
export const DuplicateUploadDialog = ({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const uploads = useUploadStore((s) => s.uploads);
  const uploadAnyway = useUploadStore((s) => s.uploadAnyway);
  const dismiss = useUploadStore((s) => s.dismiss);
  const duplicates = Object.values(uploads).filter(
    (u) => u.projectId === projectId && u.state === 'duplicate',
  );
  const open = duplicates.length > 0;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Every file needs an explicit decision: Escape must not just hide the dialog.
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[760px] max-w-[95vw] rounded-xl border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 backdrop:bg-black/70"
    >
      {open && (
        <div className="p-6">
          <h2 className="mb-1 text-lg font-semibold text-neutral-100">
            {duplicates.length === 1
              ? 'This video is already uploaded'
              : `${duplicates.length} videos are already uploaded`}
          </h2>
          <p className="mb-4 text-sm text-neutral-400">
            The same file (content hash, size and duration) is already stored. Skip it, or upload
            another copy anyway.
          </p>
          <ul className="max-h-[60vh] space-y-4 overflow-y-auto">
            {duplicates.map((u) => (
              <li key={u.key} className="rounded-lg border border-neutral-800 p-3">
                <Comparison upload={u} projectName={projectName} />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => dismiss(u.key)}
                    className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => uploadAnyway(u.key)}
                    className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
                  >
                    Upload anyway
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {duplicates.length > 1 && (
            <div className="mt-4 flex justify-end gap-2 border-t border-neutral-800 pt-4">
              <button
                onClick={() => duplicates.forEach((u) => dismiss(u.key))}
                className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
              >
                Skip all
              </button>
              <button
                onClick={() => duplicates.forEach((u) => uploadAnyway(u.key))}
                className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
              >
                Upload all anyway
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
};
