import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  formatTimecode,
  validateSegments,
  type MotionType,
  type Segment,
  type SegmentIssue,
} from '@dfs/contracts';
import { Timeline, type BoundsChange, type TimelineSegment } from '@dfs/timeline';
import { useProject } from '../api/projects';
import { useSegments } from '../api/segments';
import { useSetVideoReviewed, useVideo, useVideoMetrics, useVideos } from '../api/videos';
import {
  createSegment,
  mergeSegments,
  removeSegments,
  segmentAt,
  setBounds,
  setMotionType,
  splitAt,
  toggleAccept,
} from '../editor/segmentOps';
import { SegmentPanel } from '../editor/SegmentPanel';
import { useEditorStore, type SaveState } from '../editor/store';
import { useAutosave } from '../editor/useAutosave';
import { useHotkeys } from '../editor/useHotkeys';
import { usePlayer } from '../editor/usePlayer';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { nextReady, nextVideo, reviewQueue } from '../lib/review';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Save failed',
};

const SHORTCUTS: [string, string][] = [
  ['Space', 'play / pause'],
  ['J / K / L', 'reverse / stop / forward (press again for faster)'],
  ['← / →', 'previous / next frame'],
  ['Shift + ← / →', '1 second'],
  ['I / O', 'set in / out point'],
  ['N', 'segment from I–O'],
  ['S', 'split at playhead'],
  ['A', 'accept / reject'],
  ['M', 'merge selected'],
  ['Delete', 'delete selected'],
  ['⌘/Ctrl + Z, ⇧⌘/Ctrl + Z', 'undo / redo'],
  ['Esc', 'clear selection'],
];

export const EditorPage = () => {
  const { projectId = '', videoId = '' } = useParams();
  useProjectEvents(projectId);
  const { data: project } = useProject(projectId);
  const video = useVideo(projectId, videoId);
  const ready = video?.status === 'ready';
  const { data: serverSegments } = useSegments(videoId, ready);
  const { data: metrics } = useVideoMetrics(videoId, ready);
  const readOnly = project?.status !== 'draft';
  const { data: videos } = useVideos(projectId);
  const setReviewed = useSetVideoReviewed(projectId);
  const navigate = useNavigate();

  const store = useEditorStore();
  const { segments, selected, inPoint, outPoint, saveState, saveError } = store;
  const fps = video?.fps ?? 30;
  const duration = video?.durationSec ?? 0;

  const videoRef = useRef<HTMLVideoElement>(null);
  const player = usePlayer(videoRef, fps, duration);
  const [showHelp, setShowHelp] = useState(false);

  useAutosave(videoId, projectId, !readOnly);

  // Load server data into the editor; reload when it changed elsewhere (re-analysis)
  // and there are no unsaved local edits.
  useEffect(() => {
    if (!serverSegments) return;
    const s = useEditorStore.getState();
    const clean = s.revision === s.savedRevision && s.saveState === 'saved';
    if (s.videoId !== videoId) s.load(videoId, serverSegments);
    else if (clean && JSON.stringify(s.segments) !== JSON.stringify(serverSegments)) {
      s.load(videoId, serverSegments);
    }
  }, [serverSegments, videoId]);

  const issues = useMemo(() => {
    const map = new Map<string, SegmentIssue[]>();
    if (!project) return map;
    for (const i of validateSegments(segments, project.analysisSettings, duration)) {
      map.set(i.segmentId, [...(map.get(i.segmentId) ?? []), i]);
    }
    return map;
  }, [segments, project, duration]);

  const timelineSegments: TimelineSegment[] = useMemo(
    () =>
      segments.map((s) => ({
        id: s.id,
        startSec: s.startSec,
        endSec: s.endSec,
        motionType: s.motionType,
        accepted: s.accepted,
        warning: issues
          .get(s.id)
          ?.map((i) => i.message)
          .join('\n'),
      })),
    [segments, issues],
  );

  // ---- Actions ----
  const commit = (next: Segment[], select?: string[]) => {
    if (!readOnly) store.commit(next, select);
  };
  const targetIds = (): Set<string> => {
    if (selected.size > 0) return new Set(selected);
    const under = segmentAt(segments, player.currentTime);
    return new Set(under ? [under.id] : []);
  };
  const actions = {
    toggleAccept: () => {
      const ids = targetIds();
      if (ids.size) commit(toggleAccept(segments, ids));
    },
    remove: () => {
      if (selected.size) commit(removeSegments(segments, selected), []);
    },
    split: () => {
      const t = player.currentTime;
      const candidate =
        segments.find((s) => selected.has(s.id) && t > s.startSec && t < s.endSec) ??
        segmentAt(segments, t);
      if (!candidate) return;
      const r = splitAt(segments, candidate.id, t, fps);
      if (r) commit(r.list, [r.ids[1]]);
    },
    merge: () => {
      const r = mergeSegments(segments, selected);
      if (r) commit(r.list, [r.id]);
    },
    create: (start: number, end: number) => {
      const r = createSegment(segments, videoId, start, end, fps, metrics);
      commit(r.list, [r.id]);
    },
    createFromInOut: () => {
      if (inPoint != null && outPoint != null && outPoint > inPoint) {
        actions.create(inPoint, outPoint);
        store.setInPoint(null);
        store.setOutPoint(null);
      }
    },
    bounds: (changes: BoundsChange[]) => commit(setBounds(segments, changes, fps, duration)),
    times: (id: string, start: number, end: number) => {
      if (end <= start) return;
      commit(setBounds(segments, [{ id, startSec: start, endSec: end }], fps, duration));
    },
    motion: (type: MotionType) => {
      if (selected.size) commit(setMotionType(segments, selected, type));
    },
    loop: () => {
      const one = segments.find((s) => selected.has(s.id));
      if (!one) return;
      if (player.loop && player.loop.start === one.startSec && player.loop.end === one.endSec) {
        player.clearLoop();
        player.pause();
      } else player.playLoop(one.startSec, one.endSec);
    },
    selectOne: (id: string) => {
      store.select([id]);
      const s = segments.find((x) => x.id === id);
      if (s) player.seek(s.startSec);
    },
  };

  useHotkeys({
    Space: () => player.togglePlay(),
    KeyK: () => player.stop(),
    KeyL: () => player.shuttleForward(),
    KeyJ: () => player.shuttleReverse(),
    ArrowLeft: () => player.stepFrames(-1),
    ArrowRight: () => player.stepFrames(1),
    'Shift+ArrowLeft': () => player.stepSeconds(-1),
    'Shift+ArrowRight': () => player.stepSeconds(1),
    KeyI: () => store.setInPoint(player.currentTime),
    KeyO: () => store.setOutPoint(player.currentTime),
    KeyN: actions.createFromInOut,
    KeyS: actions.split,
    KeyA: actions.toggleAccept,
    KeyM: actions.merge,
    Delete: actions.remove,
    Backspace: actions.remove,
    Escape: () => store.select([]),
    'Mod+KeyZ': () => !readOnly && store.undo(),
    'Mod+Shift+KeyZ': () => !readOnly && store.redo(),
    'Mod+KeyY': () => !readOnly && store.redo(),
  });

  if (!video || !project) return <div className="p-8 text-neutral-500">Loading…</div>;
  if (!ready) {
    return (
      <div className="p-8">
        <Link to={`/projects/${projectId}`} className="text-sky-400">
          ← Back to project
        </Link>
        <p className="mt-4 text-neutral-400">
          The video is still being processed ({video.status}).
        </p>
      </div>
    );
  }

  // Pending edits are flushed by useAutosave's cleanup when the video changes or the page unmounts.
  // A confirmed project can't be checked, so there "Next" just walks the videos in order.
  const findNext = readOnly ? nextReady : nextVideo;
  const goNext = async () => {
    let list = videos ?? [];
    if (!readOnly && !video.reviewed) {
      const reviewed = await setReviewed.mutateAsync({ videoId, reviewed: true });
      list = list.map((v) => (v.id === reviewed.id ? reviewed : v));
    }
    const next = findNext(list, videoId);
    navigate(next ? `/projects/${projectId}/videos/${next.id}` : `/projects/${projectId}`);
  };
  const leftToReview = reviewQueue(videos ?? []).length;
  const isLast = !findNext(videos ?? [], videoId);

  const issueCount = new Set([...issues.keys()]).size;
  const accepted = segments.filter((s) => s.accepted);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-800 px-4 py-2">
        <Link to={`/projects/${projectId}`} className="text-neutral-400 hover:text-neutral-100">
          ← {project.name}
        </Link>
        <h1 className="truncate font-medium text-neutral-100">{video.originalFilename}</h1>
        <span className="tabular text-xs text-neutral-500">
          {video.width}×{video.height} · {fps.toFixed(2).replace(/\.?0+$/, '')} fps
        </span>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="text-neutral-400">
            Accepted {accepted.length} of {segments.length}
          </span>
          {issueCount > 0 && <span className="text-amber-400">⚠ Warnings: {issueCount}</span>}
          {readOnly ? (
            <span className="text-emerald-400">Read-only (project confirmed)</span>
          ) : (
            <span
              title={saveError ?? undefined}
              className={clsx(
                saveState === 'saved' && 'text-neutral-500',
                saveState === 'error' && 'text-red-400',
                (saveState === 'saving' || saveState === 'dirty') && 'text-sky-400',
              )}
            >
              {SAVE_LABEL[saveState]}
            </span>
          )}
          {!readOnly && leftToReview > 0 && (
            <span className="text-neutral-400">{leftToReview} left to review</span>
          )}
          <button
            onClick={() => void goNext()}
            disabled={setReviewed.isPending || saveState === 'error'}
            title={setReviewed.error?.message}
            className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {isLast ? 'Finish' : 'Next →'}
          </button>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800"
          >
            Shortcuts
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px]">
        <div className="flex min-h-0 flex-col">
          <div className="relative min-h-0 flex-1 bg-black">
            <video
              ref={videoRef}
              src={video.proxyUrl ?? undefined}
              className="absolute inset-0 h-full w-full object-contain"
              preload="auto"
              playsInline
              muted
              onClick={() => player.togglePlay()}
            />
            {showHelp && (
              <div className="absolute right-3 top-3 z-10 rounded-lg border border-neutral-700 bg-neutral-900/95 p-4 text-xs shadow-xl">
                <table>
                  <tbody>
                    {SHORTCUTS.map(([k, d]) => (
                      <tr key={k}>
                        <td className="pr-4 font-mono text-neutral-200">{k}</td>
                        <td className="text-neutral-400">{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-1.5 text-sm">
            <button
              className="w-8 rounded hover:bg-neutral-800"
              onClick={() => player.stepFrames(-1)}
              title="Previous frame (←)"
            >
              ⏮
            </button>
            <button
              className="w-8 rounded hover:bg-neutral-800"
              onClick={() => player.togglePlay()}
              title="Space"
            >
              {player.playing || player.shuttle !== 0 ? '⏸' : '▶'}
            </button>
            <button
              className="w-8 rounded hover:bg-neutral-800"
              onClick={() => player.stepFrames(1)}
              title="Next frame (→)"
            >
              ⏭
            </button>
            <span className="tabular text-neutral-200">{formatTimecode(player.currentTime)}</span>
            <span className="tabular text-neutral-500">/ {formatTimecode(duration)}</span>
            <span className="tabular text-xs text-neutral-500">
              frame {Math.round(player.currentTime * fps)}
            </span>
            {player.shuttle !== 0 && player.shuttle !== 1 && (
              <span className="text-xs text-sky-400">
                {player.shuttle > 0 ? `▶ ×${player.shuttle}` : `◀ ×${-player.shuttle}`}
              </span>
            )}
            {player.loop && (
              <button
                className="rounded bg-sky-900 px-2 text-xs text-sky-200"
                onClick={player.clearLoop}
              >
                loop: {formatTimecode(player.loop.start)}–{formatTimecode(player.loop.end)} ✕
              </button>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-xs">
              <span className="text-neutral-500">
                I: {inPoint != null ? formatTimecode(inPoint) : '—'} · O:{' '}
                {outPoint != null ? formatTimecode(outPoint) : '—'}
              </span>
              <button
                className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                disabled={readOnly || inPoint == null || outPoint == null || outPoint <= inPoint}
                onClick={actions.createFromInOut}
              >
                Segment from I–O (N)
              </button>
              <button
                className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                disabled={readOnly}
                onClick={actions.split}
              >
                Split (S)
              </button>
              <button
                className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                disabled={readOnly || store.past.length === 0}
                onClick={store.undo}
                title="⌘/Ctrl+Z"
              >
                Undo
              </button>
              <button
                className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                disabled={readOnly || store.future.length === 0}
                onClick={store.redo}
                title="⇧⌘/Ctrl+Z"
              >
                Redo
              </button>
            </div>
          </div>
        </div>
        <aside className="min-h-0 border-l border-neutral-800">
          <SegmentPanel
            segments={segments}
            selected={selected}
            issues={issues}
            readOnly={readOnly}
            onSelect={actions.selectOne}
            onTimes={actions.times}
            onMotion={actions.motion}
            onToggleAccept={actions.toggleAccept}
            onDelete={actions.remove}
            onMerge={actions.merge}
            onLoop={actions.loop}
          />
        </aside>
      </div>

      <div className="border-t border-neutral-800 p-3">
        <Timeline
          // Remount per video so zoom/scroll resets to fit the whole new video.
          key={videoId}
          duration={duration}
          fps={fps}
          currentTime={player.currentTime}
          onSeek={player.seek}
          segments={timelineSegments}
          selectedIds={selected}
          onSelect={(ids, mode) => store.select(ids, mode)}
          onChangeBounds={readOnly ? undefined : actions.bounds}
          onCreate={readOnly ? undefined : actions.create}
          onPreview={player.preview}
          sprite={
            video.spriteUrl && video.spriteMeta
              ? { url: video.spriteUrl, meta: video.spriteMeta }
              : null
          }
          metrics={metrics ?? null}
          inPoint={inPoint}
          outPoint={outPoint}
          followPlayhead={player.playing}
        />
      </div>
    </div>
  );
};
