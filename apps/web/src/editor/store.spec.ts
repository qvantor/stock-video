import type { Segment } from '@dfs/contracts';
import { useEditorStore } from './store';

const seg = (id: string): Segment => ({
  id,
  videoId: 'v',
  startSec: 0,
  endSec: 10,
  motionType: 'forward',
  score: 1,
  reasons: [],
  origin: 'ai',
  accepted: true,
  edited: false,
});

describe('editor store history', () => {
  beforeEach(() => useEditorStore.getState().load('v', [seg('a')]));

  it('undoes and redoes commits', () => {
    const { commit } = useEditorStore.getState();
    commit([seg('a'), seg('b')]);
    commit([seg('b')]);
    expect(useEditorStore.getState().segments.map((s) => s.id)).toEqual(['b']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().segments.map((s) => s.id)).toEqual(['a', 'b']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().segments.map((s) => s.id)).toEqual(['a']);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().segments.map((s) => s.id)).toEqual(['a', 'b']);
    expect(useEditorStore.getState().saveState).toBe('dirty');
  });

  it('a new commit clears the redo stack and prunes selection', () => {
    const s = useEditorStore.getState();
    s.select(['a']);
    s.commit([seg('b')]);
    expect(useEditorStore.getState().selected.size).toBe(0);
    useEditorStore.getState().undo();
    useEditorStore.getState().commit([seg('c')]);
    expect(useEditorStore.getState().future).toHaveLength(0);
  });

  it('tracks save state by revision', () => {
    const s = useEditorStore.getState();
    s.commit([seg('b')]);
    const rev = useEditorStore.getState().revision;
    s.markSaving();
    s.commit([seg('c')]);
    s.markSaved(rev);
    expect(useEditorStore.getState().saveState).toBe('dirty');
    s.markSaved(useEditorStore.getState().revision);
    expect(useEditorStore.getState().saveState).toBe('saved');
  });
});

describe('editor store selection and loading', () => {
  beforeEach(() => {
    useEditorStore.setState({ videoId: null });
    useEditorStore.getState().load('v', [seg('a'), seg('b'), seg('c')]);
  });

  it('selects with replace, toggle and add modes', () => {
    const { select } = useEditorStore.getState();
    select(['a', 'b']);
    select(['c']);
    expect([...useEditorStore.getState().selected]).toEqual(['c']);
    select(['a', 'c'], 'toggle');
    expect([...useEditorStore.getState().selected]).toEqual(['a']);
    select(['a', 'b'], 'add');
    expect([...useEditorStore.getState().selected].sort()).toEqual(['a', 'b']);
  });

  it('reloading the same video keeps history, selection and in/out points', () => {
    const s = useEditorStore.getState();
    s.select(['a', 'b']);
    s.setInPoint(1);
    s.setOutPoint(4);
    s.commit([seg('a'), seg('b')]);
    useEditorStore.getState().load('v', [seg('a')]);
    const next = useEditorStore.getState();
    expect([...next.selected]).toEqual(['a']);
    expect(next.past).toHaveLength(1);
    expect(next.inPoint).toBe(1);
    expect(next.outPoint).toBe(4);
    expect(next.saveState).toBe('saved');
  });

  it('loading another video resets history, selection and in/out points', () => {
    const s = useEditorStore.getState();
    s.select(['a']);
    s.setInPoint(1);
    s.commit([seg('a')]);
    useEditorStore.getState().load('w', [seg('a')]);
    const next = useEditorStore.getState();
    expect(next.selected.size).toBe(0);
    expect(next.past).toHaveLength(0);
    expect(next.future).toHaveLength(0);
    expect(next.inPoint).toBeNull();
  });

  it('caps undo history at 100 steps', () => {
    for (let i = 0; i < 120; i++) useEditorStore.getState().commit([seg(`s${i}`)]);
    expect(useEditorStore.getState().past).toHaveLength(100);
  });

  it('undo and redo with empty stacks are no-ops', () => {
    const before = useEditorStore.getState();
    before.undo();
    before.redo();
    const after = useEditorStore.getState();
    expect(after.segments).toBe(before.segments);
    expect(after.revision).toBe(before.revision);
  });

  it('records save errors', () => {
    useEditorStore.getState().markSaveError('boom');
    expect(useEditorStore.getState()).toMatchObject({ saveState: 'error', saveError: 'boom' });
    useEditorStore.getState().markSaving();
    expect(useEditorStore.getState()).toMatchObject({ saveState: 'saving', saveError: null });
  });
});
