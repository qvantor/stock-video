import { create } from 'zustand';
import type { Segment } from '@dfs/contracts';

const HISTORY_LIMIT = 100;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface EditorState {
  videoId: string | null;
  segments: Segment[];
  selected: ReadonlySet<string>;
  past: Segment[][];
  future: Segment[][];
  /** Incremented on every change; autosave persists the latest revision. */
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  saveError: string | null;
  inPoint: number | null;
  outPoint: number | null;

  load: (videoId: string, segments: Segment[]) => void;
  /** Apply a new segment list as one undoable step. */
  commit: (next: Segment[], select?: string[]) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void;
  setInPoint: (t: number | null) => void;
  setOutPoint: (t: number | null) => void;
  markSaving: () => void;
  markSaved: (revision: number) => void;
  markSaveError: (message: string) => void;
}

const pruneSelection = (selected: ReadonlySet<string>, list: Segment[]): Set<string> => {
  const ids = new Set(list.map((s) => s.id));
  return new Set([...selected].filter((id) => ids.has(id)));
};

export const useEditorStore = create<EditorState>((set) => ({
  videoId: null,
  segments: [],
  selected: new Set(),
  past: [],
  future: [],
  revision: 0,
  savedRevision: 0,
  saveState: 'saved',
  saveError: null,
  inPoint: null,
  outPoint: null,

  load: (videoId, segments) =>
    set((s) => ({
      videoId,
      segments,
      selected: s.videoId === videoId ? pruneSelection(s.selected, segments) : new Set(),
      past: s.videoId === videoId ? s.past : [],
      future: s.videoId === videoId ? s.future : [],
      revision: 0,
      savedRevision: 0,
      saveState: 'saved',
      saveError: null,
      inPoint: s.videoId === videoId ? s.inPoint : null,
      outPoint: s.videoId === videoId ? s.outPoint : null,
    })),

  commit: (next, select) =>
    set((s) => ({
      segments: next,
      past: [...s.past, s.segments].slice(-HISTORY_LIMIT),
      future: [],
      selected: select ? new Set(select) : pruneSelection(s.selected, next),
      revision: s.revision + 1,
      saveState: 'dirty',
    })),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        segments: prev,
        past: s.past.slice(0, -1),
        future: [s.segments, ...s.future].slice(0, HISTORY_LIMIT),
        selected: pruneSelection(s.selected, prev),
        revision: s.revision + 1,
        saveState: 'dirty',
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        segments: next,
        past: [...s.past, s.segments].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        selected: pruneSelection(s.selected, next),
        revision: s.revision + 1,
        saveState: 'dirty',
      };
    }),

  select: (ids, mode = 'replace') =>
    set((s) => {
      if (mode === 'replace') return { selected: new Set(ids) };
      const next = new Set(s.selected);
      for (const id of ids) {
        if (mode === 'toggle' && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return { selected: next };
    }),

  setInPoint: (t) => set({ inPoint: t }),
  setOutPoint: (t) => set({ outPoint: t }),
  markSaving: () => set({ saveState: 'saving', saveError: null }),
  markSaved: (revision) =>
    set((s) => ({
      savedRevision: revision,
      saveState: s.revision === revision ? 'saved' : 'dirty',
      saveError: null,
    })),
  markSaveError: (message) => set({ saveState: 'error', saveError: message }),
}));
