import { Link } from 'react-router-dom';
import type { SourceVideo } from '@dfs/contracts';
import { formatBytes, formatDuration } from '../lib/format';
import { SpriteThumb } from './SpriteThumb';
import { StageProgress } from './StageProgress';

interface Props {
  video: SourceVideo;
  readOnly: boolean;
  segmentInfo?: { proposed: number; accepted: number };
  onRetry: () => void;
  onDelete: () => void;
  onUncheck: () => void;
}

export const VideoCard = ({
  video,
  readOnly,
  segmentInfo,
  onRetry,
  onDelete,
  onUncheck,
}: Props) => {
  const ready = video.status === 'ready';
  const body = (
    <div className="flex gap-4 p-3">
      <div className="flex h-[90px] w-[160px] shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-800">
        {video.spriteUrl && video.spriteMeta ? (
          <SpriteThumb
            spriteUrl={video.spriteUrl}
            meta={video.spriteMeta}
            index={Math.floor(video.spriteMeta.count / 3)}
            width={160}
          />
        ) : (
          <span className="text-xs text-neutral-500">no preview</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate font-medium text-neutral-100" title={video.originalFilename}>
          {video.originalFilename}
        </div>
        <div className="tabular flex flex-wrap gap-x-3 text-xs text-neutral-400">
          {video.durationSec !== null && <span>{formatDuration(video.durationSec)}</span>}
          {video.width !== null && video.height !== null && (
            <span>
              {video.width}×{video.height}
            </span>
          )}
          {video.fps !== null && <span>{video.fps.toFixed(2).replace(/\.?0+$/, '')} fps</span>}
          {video.codec && <span className="uppercase">{video.codec}</span>}
          <span>{formatBytes(video.sizeBytes)}</span>
        </div>
        {video.duplicateOf && (
          // Plain text: the card itself is a link once the video is ready.
          <div className="truncate text-xs text-amber-400">
            Duplicate of “{video.duplicateOf.originalFilename}”{' '}
            {video.duplicateOf.projectId === video.projectId
              ? 'in this project'
              : `in project “${video.duplicateOf.projectName}”`}
          </div>
        )}
        <div className="mt-auto">
          {ready ? (
            <div className="text-sm text-emerald-400">
              Ready
              {video.reviewed && <span className="ml-2 text-sky-400">✓ Checked</span>}
              {segmentInfo && (
                <span className="text-neutral-400">
                  {' '}
                  · segments: {segmentInfo.proposed}, accepted: {segmentInfo.accepted}
                </span>
              )}
            </div>
          ) : video.status === 'failed' ? (
            <div className="text-sm text-red-400" title={video.error ?? undefined}>
              <span className="line-clamp-2">Error: {video.error ?? 'unknown error'}</span>
            </div>
          ) : (
            <StageProgress status={video.status} progress={video.progress} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <li className="group relative rounded-lg border border-neutral-800 bg-neutral-900/60 hover:border-neutral-700">
      {ready ? (
        <Link to={`videos/${video.id}`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
      {!readOnly && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {video.reviewed && (
            <button
              onClick={onUncheck}
              className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
            >
              Uncheck
            </button>
          )}
          {video.status === 'failed' && video.storedPath && (
            <button
              onClick={onRetry}
              className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm(`Delete “${video.originalFilename}” and its segments?`))
                onDelete();
            }}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-red-900"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
};
