import { useUploadStore } from '../uploads/uploadStore';

/** Uploads that the server does not know about yet (waiting for a slot) or that failed to start. */
export const LocalUploads = ({ projectId }: { projectId: string }) => {
  const uploads = useUploadStore((s) => s.uploads);
  const retry = useUploadStore((s) => s.retry);
  const dismiss = useUploadStore((s) => s.dismiss);
  const visible = Object.values(uploads).filter(
    (u) =>
      u.projectId === projectId &&
      (u.state === 'checking' || u.state === 'waiting' || u.state === 'error'),
  );
  if (visible.length === 0) return null;
  return (
    <ul className="mb-4 space-y-1">
      {visible.map((u) => (
        <li
          key={u.key}
          className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2 text-sm"
        >
          <span className="flex-1 truncate">{u.filename}</span>
          {u.state === 'checking' ? (
            <span className="text-neutral-500">checking for duplicates…</span>
          ) : u.state === 'waiting' ? (
            <span className="text-neutral-500">waiting to upload…</span>
          ) : (
            <>
              <span className="truncate text-red-400" title={u.error}>
                {u.error}
              </span>
              <button onClick={() => retry(u.key)} className="text-sky-400 hover:underline">
                retry
              </button>
              <button onClick={() => dismiss(u.key)} className="text-neutral-500 hover:underline">
                dismiss
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
};
