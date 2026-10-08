import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MOTION_COLORS } from './colors';
import { BANDS_H, RULER_H, drawBands } from './draw';
import {
  clamp,
  clampViewport,
  snapTime,
  snapToFrame,
  timeToX,
  xToTime,
  zoomAt,
  zoomLimits,
  type Viewport,
} from './geometry';
import type { BoundsChange, TimelineProps } from './types';

const LANE_H = 46;
const SCROLL_H = 10;
const HANDLE_PX = 7;
const DRAG_THRESHOLD_PX = 3;

type Drag =
  | { kind: 'scrub' }
  | {
      kind: 'move';
      ids: string[];
      origin: Map<string, { s: number; e: number }>;
      anchorT: number;
      startX: number;
      moved: boolean;
      clickId: string;
      modifier: boolean;
    }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; s: number; e: number }
  | { kind: 'create'; t0: number; startX: number; moved: boolean }
  | { kind: 'marquee'; t0: number; startX: number; mode: 'add' | 'toggle' }
  | { kind: 'scroll'; startX: number; startView: number };

type Preview = Map<string, { s: number; e: number }>;

export const Timeline = (props: TimelineProps) => {
  const {
    duration,
    fps,
    currentTime,
    onSeek,
    segments,
    selectedIds,
    onSelect,
    onChangeBounds,
    onCreate,
    onPreview,
    sprite,
    metrics,
    inPoint,
    outPoint,
    followPlayhead,
    className,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<{ start: number; pxPerSec: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ghost, setGhost] = useState<{ s: number; e: number; kind: 'create' | 'marquee' } | null>(
    null,
  );
  const dragRef = useRef<Drag | null>(null);
  const [spriteImage, setSpriteImage] = useState<HTMLImageElement | null>(null);

  // Measure width.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fit the whole video initially and keep the viewport valid on resize.
  const viewport: Viewport = useMemo(() => {
    const { min } = zoomLimits(duration, width, fps);
    const base = view ?? { start: 0, pxPerSec: min };
    return clampViewport({ ...base, pxPerSec: Math.max(base.pxPerSec, min), width }, duration);
  }, [view, width, duration, fps]);

  // Sprite image.
  useEffect(() => {
    if (!sprite) {
      setSpriteImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setSpriteImage(img);
    img.src = sprite.url;
    return () => {
      img.onload = null;
    };
  }, [sprite]);

  // Draw ruler, thumbnails, graph.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(BANDS_H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBands(
      ctx,
      viewport,
      duration,
      sprite && spriteImage ? { data: sprite, image: spriteImage } : null,
      metrics,
    );
  }, [viewport, width, duration, sprite, spriteImage, metrics]);

  // Follow the playhead while playing.
  useEffect(() => {
    if (!followPlayhead || width === 0) return;
    const visible = width / viewport.pxPerSec;
    if (currentTime < viewport.start || currentTime > viewport.start + visible * 0.95) {
      setView({ start: currentTime - visible * 0.05, pxPerSec: viewport.pxPerSec });
    }
  }, [currentTime, followPlayhead, viewport, width]);

  // Wheel: Ctrl/Cmd (or trackpad pinch) zooms around the cursor, otherwise scrolls.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0025);
        setView((prev) => {
          const v = { ...(prev ?? viewport), width: viewport.width };
          const z = zoomAt(v, factor, e.clientX - rect.left, duration, fps);
          return { start: z.start, pxPerSec: z.pxPerSec };
        });
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView((prev) => {
          const v = prev ?? viewport;
          return { start: v.start + delta / v.pxPerSec, pxPerSec: v.pxPerSec };
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport, duration, fps]);

  const localX = (e: { clientX: number }) =>
    e.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0);
  const timeAt = (e: { clientX: number }) => clamp(xToTime(localX(e), viewport), 0, duration);

  const snapTargets = useCallback(
    (exclude: ReadonlySet<string>) => {
      const targets = [0, duration, currentTime];
      if (inPoint != null) targets.push(inPoint);
      if (outPoint != null) targets.push(outPoint);
      for (const s of segments) {
        if (exclude.has(s.id)) continue;
        targets.push(s.startSec, s.endSec);
      }
      return targets;
    },
    [segments, duration, currentTime, inPoint, outPoint],
  );

  const segById = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);
  const editable = Boolean(onChangeBounds);

  // ---- Pointer handling ----
  const beginDrag = (e: ReactPointerEvent, drag: Drag) => {
    dragRef.current = drag;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onBandsDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    onSeek(snapToFrame(timeAt(e), fps));
    beginDrag(e, { kind: 'scrub' });
  };

  const onLaneDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const t = timeAt(e);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      beginDrag(e, {
        kind: 'marquee',
        t0: t,
        startX: localX(e),
        mode: e.shiftKey ? 'add' : 'toggle',
      });
      return;
    }
    beginDrag(e, { kind: 'create', t0: snapToFrame(t, fps), startX: localX(e), moved: false });
  };

  const onBlockDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const modifier = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids: string[];
    if (modifier) {
      onSelect([id], 'toggle');
      ids = selectedIds.has(id) ? [] : [...selectedIds, id];
    } else if (selectedIds.has(id)) {
      ids = [...selectedIds];
    } else {
      onSelect([id], 'replace');
      ids = [id];
    }
    if (!editable || ids.length === 0) {
      e.stopPropagation();
      return;
    }
    const origin = new Map<string, { s: number; e: number }>();
    for (const sid of ids) {
      const s = segById.get(sid);
      if (s) origin.set(sid, { s: s.startSec, e: s.endSec });
    }
    beginDrag(e, {
      kind: 'move',
      ids,
      origin,
      anchorT: xToTime(localX(e), viewport),
      startX: localX(e),
      moved: false,
      clickId: id,
      modifier,
    });
  };

  const onHandleDown = (e: ReactPointerEvent, id: string, edge: 'start' | 'end') => {
    if (e.button !== 0 || !editable) return;
    const s = segById.get(id);
    if (!s) return;
    if (!selectedIds.has(id)) onSelect([id], 'replace');
    beginDrag(e, { kind: 'resize', id, edge, s: s.startSec, e: s.endSec });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frame = 1 / fps;
    switch (drag.kind) {
      case 'scrub':
        onSeek(snapToFrame(timeAt(e), fps));
        break;
      case 'scroll': {
        const dx = localX(e) - drag.startX;
        setView({ start: drag.startView + (dx / width) * duration, pxPerSec: viewport.pxPerSec });
        break;
      }
      case 'move': {
        if (!drag.moved && Math.abs(localX(e) - drag.startX) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        let delta = xToTime(localX(e), viewport) - drag.anchorT;
        const spans = [...drag.origin.values()];
        const gs = Math.min(...spans.map((o) => o.s));
        const ge = Math.max(...spans.map((o) => o.e));
        const targets = snapTargets(new Set(drag.ids));
        const sStart = snapTime(gs + delta, targets, viewport.pxPerSec, fps);
        const sEnd = snapTime(ge + delta, targets, viewport.pxPerSec, fps);
        if (sStart.snapped) delta = sStart.t - gs;
        else if (sEnd.snapped) delta = sEnd.t - ge;
        else delta = Math.round(delta * fps) / fps;
        delta = clamp(delta, -gs, duration - ge);
        const next: Preview = new Map();
        for (const [id, o] of drag.origin) next.set(id, { s: o.s + delta, e: o.e + delta });
        setPreview(next);
        break;
      }
      case 'resize': {
        const targets = snapTargets(new Set([drag.id]));
        const t = snapTime(timeAt(e), targets, viewport.pxPerSec, fps).t;
        const next: Preview = new Map();
        const p =
          drag.edge === 'start'
            ? { s: clamp(t, 0, drag.e - frame), e: drag.e }
            : { s: drag.s, e: clamp(t, drag.s + frame, duration) };
        next.set(drag.id, p);
        setPreview(next);
        onPreview?.(drag.edge === 'start' ? p.s : p.e);
        break;
      }
      case 'create': {
        if (!drag.moved && Math.abs(localX(e) - drag.startX) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        const t = snapTime(timeAt(e), snapTargets(new Set()), viewport.pxPerSec, fps).t;
        setGhost({ s: Math.min(drag.t0, t), e: Math.max(drag.t0, t), kind: 'create' });
        onPreview?.(t);
        break;
      }
      case 'marquee': {
        const t = timeAt(e);
        setGhost({ s: Math.min(drag.t0, t), e: Math.max(drag.t0, t), kind: 'marquee' });
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    switch (drag.kind) {
      case 'move':
        if (drag.moved && preview && onChangeBounds) {
          onChangeBounds(
            [...preview].map(([id, p]): BoundsChange => ({ id, startSec: p.s, endSec: p.e })),
          );
        } else if (!drag.moved && !drag.modifier) {
          onSelect([drag.clickId], 'replace');
        }
        break;
      case 'resize': {
        onPreview?.(null);
        const p = preview?.get(drag.id);
        if (p && onChangeBounds && (p.s !== drag.s || p.e !== drag.e)) {
          onChangeBounds([{ id: drag.id, startSec: p.s, endSec: p.e }]);
        }
        break;
      }
      case 'create':
        if (drag.moved) onPreview?.(null);
        if (drag.moved && ghost && ghost.e - ghost.s >= 1 / fps && onCreate) {
          onCreate(ghost.s, ghost.e);
        } else if (!drag.moved) {
          onSelect([], 'replace');
          onSeek(snapToFrame(timeAt(e), fps));
        }
        break;
      case 'marquee':
        if (ghost) {
          const ids = segments
            .filter((s) => s.startSec < ghost.e && s.endSec > ghost.s)
            .map((s) => s.id);
          onSelect(ids, drag.mode);
        }
        break;
      default:
        break;
    }
    setPreview(null);
    setGhost(null);
  };

  // ---- Zoom controls ----
  const zoomBy = (factor: number) => {
    const anchor = clamp(timeToX(currentTime, viewport), 0, width);
    const z = zoomAt(viewport, factor, anchor, duration, fps);
    setView({ start: z.start, pxPerSec: z.pxPerSec });
  };
  const fit = () => setView(null);

  // ---- Render ----
  const x = (t: number) => timeToX(t, viewport);
  const playX = x(currentTime);
  const visibleDur = width > 0 ? width / viewport.pxPerSec : duration;
  const scrollThumbW = duration > 0 ? Math.max(24, (visibleDur / duration) * width) : width;
  const scrollThumbX = duration > 0 ? (viewport.start / duration) * width : 0;

  return (
    <div className={className}>
      <div
        ref={rootRef}
        className="relative overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 select-none touch-none"
        style={{ height: BANDS_H + LANE_H + SCROLL_H }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 cursor-col-resize"
          style={{ width, height: BANDS_H }}
          onPointerDown={onBandsDown}
        />

        {/* Segment lane */}
        <div
          className="absolute left-0 right-0 cursor-crosshair bg-neutral-900/40"
          style={{ top: BANDS_H, height: LANE_H }}
          onPointerDown={onLaneDown}
        >
          {segments.map((s) => {
            const p = preview?.get(s.id);
            const start = p ? p.s : s.startSec;
            const end = p ? p.e : s.endSec;
            const left = x(start);
            const w = Math.max(2, x(end) - left);
            if (left > width || left + w < 0) return null;
            const color = MOTION_COLORS[s.motionType];
            const selected = selectedIds.has(s.id);
            const style: CSSProperties = {
              left,
              width: w,
              background: s.accepted
                ? `${color}cc`
                : `repeating-linear-gradient(135deg, ${color}55 0 6px, transparent 6px 12px)`,
              borderColor: s.warning ? '#f59e0b' : selected ? '#fafafa' : color,
            };
            return (
              <div
                key={s.id}
                title={s.warning}
                className={`absolute top-1 bottom-1 rounded border-2 ${
                  selected ? 'z-10 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]' : ''
                } ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                style={style}
                onPointerDown={(e) => onBlockDown(e, s.id)}
              >
                {s.warning && (
                  <span className="pointer-events-none absolute right-1 top-0.5 text-xs font-bold text-amber-300">
                    !
                  </span>
                )}
                {w > 60 && (
                  <span className="pointer-events-none absolute left-1.5 top-1 truncate text-[10px] font-medium text-neutral-950/80">
                    {(end - start).toFixed(1)} s
                  </span>
                )}
                {editable && (
                  <>
                    <div
                      className="absolute -left-1 top-0 bottom-0 cursor-ew-resize"
                      style={{ width: HANDLE_PX }}
                      onPointerDown={(e) => onHandleDown(e, s.id, 'start')}
                    />
                    <div
                      className="absolute -right-1 top-0 bottom-0 cursor-ew-resize"
                      style={{ width: HANDLE_PX }}
                      onPointerDown={(e) => onHandleDown(e, s.id, 'end')}
                    />
                  </>
                )}
              </div>
            );
          })}
          {ghost && (
            <div
              className={`pointer-events-none absolute top-1 bottom-1 rounded border border-dashed ${
                ghost.kind === 'create'
                  ? 'border-sky-300 bg-sky-400/20'
                  : 'border-neutral-300 bg-neutral-300/10'
              }`}
              style={{ left: x(ghost.s), width: Math.max(1, x(ghost.e) - x(ghost.s)) }}
            />
          )}
        </div>

        {/* In / Out markers */}
        {inPoint != null && (
          <div
            className="pointer-events-none absolute top-0 border-l-2 border-yellow-400"
            style={{ left: x(inPoint), height: BANDS_H + LANE_H }}
          >
            <span className="absolute left-0.5 top-0 text-[10px] font-bold text-yellow-300">I</span>
          </div>
        )}
        {outPoint != null && (
          <div
            className="pointer-events-none absolute top-0 border-r-2 border-yellow-400"
            style={{ left: x(outPoint) - 2, height: BANDS_H + LANE_H }}
          >
            <span className="absolute right-0.5 top-0 text-[10px] font-bold text-yellow-300">
              O
            </span>
          </div>
        )}
        {inPoint != null && outPoint != null && outPoint > inPoint && (
          <div
            className="pointer-events-none absolute top-0 bg-yellow-400/10"
            style={{ left: x(inPoint), width: x(outPoint) - x(inPoint), height: RULER_H }}
          />
        )}

        {/* Playhead */}
        {playX >= -1 && playX <= width + 1 && (
          <div
            className="pointer-events-none absolute top-0 z-20 w-px bg-red-500"
            style={{ left: playX, height: BANDS_H + LANE_H }}
          >
            <div className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
          </div>
        )}

        {/* Scrollbar */}
        <div
          className="absolute left-0 right-0 bg-neutral-900"
          style={{ top: BANDS_H + LANE_H, height: SCROLL_H }}
        >
          <div
            className="absolute top-1 bottom-1 cursor-grab rounded-full bg-neutral-600 hover:bg-neutral-500"
            style={{ left: scrollThumbX, width: scrollThumbW }}
            onPointerDown={(e) =>
              beginDrag(e, { kind: 'scroll', startX: localX(e), startView: viewport.start })
            }
          />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
        <button
          type="button"
          className="rounded px-1.5 hover:bg-neutral-800"
          onClick={() => zoomBy(1 / 1.5)}
        >
          −
        </button>
        <button
          type="button"
          className="rounded px-1.5 hover:bg-neutral-800"
          onClick={() => zoomBy(1.5)}
        >
          +
        </button>
        <button type="button" className="rounded px-1.5 hover:bg-neutral-800" onClick={fit}>
          fit all
        </button>
        <span>
          Ctrl/⌘ + wheel — zoom · wheel — scroll · drag on empty space — new segment · Shift — box
          select
        </span>
      </div>
    </div>
  );
};
