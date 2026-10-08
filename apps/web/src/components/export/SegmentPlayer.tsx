import { useEffect, useRef } from 'react';
import { usePlayer } from '../../editor/usePlayer';

/** Proxy video looping one segment. */
export const SegmentPlayer = ({
  src,
  fps,
  duration,
  start,
  end,
}: {
  src: string;
  fps: number;
  duration: number;
  start: number;
  end: number;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const player = usePlayer(ref, fps, duration);
  const { seek, clearLoop } = player;

  useEffect(() => {
    seek(start);
    return () => clearLoop();
  }, [start, seek, clearLoop]);

  const toggle = () => (player.playing ? player.pause() : player.playLoop(start, end));
  const progress = Math.max(
    0,
    Math.min(1, (player.currentTime - start) / Math.max(0.001, end - start)),
  );

  return (
    <div className="overflow-hidden rounded border border-neutral-800 bg-black">
      <video
        ref={ref}
        src={src}
        preload="metadata"
        playsInline
        muted
        className="aspect-video w-full"
        onClick={toggle}
      />
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          onClick={toggle}
          className="w-14 rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700"
        >
          {player.playing ? 'Pause' : 'Play'}
        </button>
        <div className="h-1 flex-1 rounded bg-neutral-800">
          <div className="h-1 rounded bg-sky-500" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
};
