import clsx from 'clsx';
import {
  formatTimecode,
  MOTION_LABELS,
  MOTION_TYPES,
  type MotionType,
  type Segment,
  type SegmentIssue,
} from '@dfs/contracts';
import { MOTION_COLORS } from '@dfs/timeline';
import { TimecodeInput } from './TimecodeInput';

interface Props {
  segments: Segment[];
  selected: ReadonlySet<string>;
  issues: Map<string, SegmentIssue[]>;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onTimes: (id: string, start: number, end: number) => void;
  onMotion: (type: MotionType) => void;
  onToggleAccept: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onLoop: () => void;
}

const ScoreBar = ({ score }: { score: number }) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 flex-1 rounded-full bg-neutral-800">
      <div
        className={clsx(
          'h-1.5 rounded-full',
          score >= 0.75 ? 'bg-emerald-500' : score >= 0.5 ? 'bg-amber-500' : 'bg-red-500',
        )}
        style={{ width: `${score * 100}%` }}
      />
    </div>
    <span className="tabular text-xs text-neutral-300">{Math.round(score * 100)}</span>
  </div>
);

export const SegmentPanel = (p: Props) => {
  const chosen = p.segments.filter((s) => p.selected.has(s.id));
  const one = chosen.length === 1 ? chosen[0] : undefined;
  const btn =
    'rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-neutral-800';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      {one ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: MOTION_COLORS[one.motionType] }}
            />
            <h2 className="font-semibold text-neutral-100">Segment</h2>
            <span className="ml-auto text-xs text-neutral-500">
              {one.origin === 'ai' ? (one.edited ? 'AI · edited' : 'AI') : 'manual'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TimecodeInput
              label="Start"
              value={one.startSec}
              disabled={p.readOnly}
              onCommit={(t) => p.onTimes(one.id, t, one.endSec)}
            />
            <TimecodeInput
              label="End"
              value={one.endSec}
              disabled={p.readOnly}
              onCommit={(t) => p.onTimes(one.id, one.startSec, t)}
            />
          </div>
          <div className="tabular text-neutral-300">
            Duration: {(one.endSec - one.startSec).toFixed(2)} s
          </div>
          <label className="flex flex-col gap-0.5 text-xs text-neutral-400">
            Motion type
            <select
              value={one.motionType}
              disabled={p.readOnly}
              onChange={(e) => p.onMotion(e.target.value as MotionType)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
            >
              {MOTION_TYPES.map((m) => (
                <option key={m} value={m}>
                  {MOTION_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-1 text-xs text-neutral-400">Score</div>
            <ScoreBar score={one.score} />
          </div>
          {one.reasons.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-xs text-neutral-300">
              {one.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      ) : chosen.length > 1 ? (
        <section className="space-y-1">
          <h2 className="font-semibold text-neutral-100">Selected segments: {chosen.length}</h2>
          <div className="tabular text-neutral-400">
            Total duration: {chosen.reduce((a, s) => a + s.endSec - s.startSec, 0).toFixed(1)} s
          </div>
          <label className="flex flex-col gap-0.5 pt-2 text-xs text-neutral-400">
            Set motion type
            <select
              value=""
              disabled={p.readOnly}
              onChange={(e) => e.target.value && p.onMotion(e.target.value as MotionType)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
            >
              <option value="">—</option>
              {MOTION_TYPES.map((m) => (
                <option key={m} value={m}>
                  {MOTION_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : (
        <p className="text-neutral-500">
          Select a segment on the timeline or in the list. Drag across empty track space to create a
          new one.
        </p>
      )}

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button className={btn} disabled={p.readOnly} onClick={p.onToggleAccept}>
            {chosen.every((s) => s.accepted) ? 'Reject (A)' : 'Accept (A)'}
          </button>
          <button className={btn} disabled={p.readOnly} onClick={p.onDelete}>
            Delete (Del)
          </button>
          <button className={btn} disabled={p.readOnly || chosen.length < 2} onClick={p.onMerge}>
            Merge (M)
          </button>
          <button className={btn} disabled={!one} onClick={p.onLoop}>
            Loop
          </button>
        </div>
      )}

      {chosen.some((s) => p.issues.has(s.id)) && (
        <ul className="space-y-1 rounded border border-amber-700/60 bg-amber-950/30 p-2 text-xs text-amber-300">
          {[
            ...new Set(chosen.flatMap((s) => (p.issues.get(s.id) ?? []).map((i) => i.message))),
          ].map((m) => (
            <li key={m}>⚠ {m}</li>
          ))}
        </ul>
      )}

      <section className="mt-auto">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          All segments ({p.segments.length})
        </h3>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {p.segments.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => p.onSelect(s.id)}
                className={clsx(
                  'tabular flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800',
                  p.selected.has(s.id) && 'bg-neutral-800',
                  !s.accepted && 'opacity-50',
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: MOTION_COLORS[s.motionType] }}
                />
                <span>{formatTimecode(s.startSec)}</span>
                <span className="text-neutral-500">{(s.endSec - s.startSec).toFixed(1)} s</span>
                <span className="truncate text-neutral-400">{MOTION_LABELS[s.motionType]}</span>
                {p.issues.has(s.id) && <span className="ml-auto text-amber-400">⚠</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
