import { useEffect, useState } from 'react';
import type { ExportVideo } from '@dfs/contracts';
import { useSetVideoLocation } from '../../api/export';

const LocationRow = ({ projectId, video }: { projectId: string; video: ExportVideo }) => {
  const [value, setValue] = useState(video.manualLocation ?? '');
  const save = useSetVideoLocation(projectId);
  useEffect(() => setValue(video.manualLocation ?? ''), [video.manualLocation]);
  const changed = value.trim() !== (video.manualLocation ?? '');

  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="w-48 truncate text-neutral-200" title={video.originalFilename}>
        {video.originalFilename}
      </span>
      <span className="w-40 text-xs text-neutral-500">
        {video.embeddedLocation
          ? `GPS ${video.embeddedLocation.lat.toFixed(4)}, ${video.embeddedLocation.lon.toFixed(4)}`
          : 'no GPS in file'}
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) =>
          e.key === 'Enter' &&
          changed &&
          save.mutate({ videoId: video.id, location: value.trim() || null })
        }
        placeholder={
          video.embeddedLocation
            ? 'Override: city / landmark / country or lat, lon'
            : 'City / landmark / country or lat, lon'
        }
        className="min-w-[220px] flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
      />
      <button
        disabled={!changed || save.isPending}
        onClick={() => save.mutate({ videoId: video.id, location: value.trim() || null })}
        className="rounded bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40"
        title="Saves the location and re-runs location + metadata for this video's clips"
      >
        {save.isPending ? 'Saving…' : 'Apply'}
      </button>
      {save.error && <span className="w-full text-xs text-red-400">{save.error.message}</span>}
    </li>
  );
};

/** Per-video manual location (used when the file has no GPS, or to override it). */
export const VideoLocations = ({
  projectId,
  videos,
}: {
  projectId: string;
  videos: ExportVideo[];
}) => (
  <section className="rounded-lg border border-neutral-800 px-4 py-2">
    <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
      Location per video
    </h2>
    <ul className="divide-y divide-neutral-800">
      {videos.map((v) => (
        <LocationRow key={v.id} projectId={projectId} video={v} />
      ))}
    </ul>
  </section>
);
