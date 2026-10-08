import clsx from 'clsx';
import type { VideoStatus } from '@dfs/contracts';

const STAGES: { status: VideoStatus; label: string }[] = [
  { status: 'uploading', label: 'Upload' },
  { status: 'queued', label: 'Queued' },
  { status: 'probing', label: 'Probing' },
  { status: 'proxy', label: 'Proxy' },
  { status: 'analyzing', label: 'Motion analysis' },
];

export const STATUS_LABEL: Record<VideoStatus, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  probing: 'Probing file',
  proxy: 'Proxy & thumbnails',
  analyzing: 'Analysing motion',
  ready: 'Ready',
  failed: 'Failed',
};

/** Stage chips + progress bar of the current stage. */
export const StageProgress = ({ status, progress }: { status: VideoStatus; progress: number }) => {
  const current = STAGES.findIndex((s) => s.status === status);
  return (
    <div className="w-full">
      <div className="mb-1 flex gap-1">
        {STAGES.map((s, i) => (
          <div
            key={s.status}
            title={s.label}
            className={clsx(
              'h-1 flex-1 rounded-full',
              i < current ? 'bg-sky-600' : i === current ? 'bg-sky-900' : 'bg-neutral-800',
            )}
          >
            {i === current && (
              <div
                className="h-1 rounded-full bg-sky-400 transition-[width]"
                style={{ width: `${progress * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="tabular text-xs text-neutral-400">
        {STATUS_LABEL[status]}
        {status !== 'queued' && ` · ${Math.round(progress * 100)}%`}
      </div>
    </div>
  );
};
