import type { ClipStep } from '@dfs/contracts';
import { ExportPipeline, type PipelineEvents } from './pipeline.js';
import type { ClipRecord, PipelineStep, PipelineSteps } from './types.js';
import { MemoryStore } from '../test/memory-store.js';
import { fakeVideos, manifest, settingsWith, silentLog } from '../test/fixtures.js';

interface FakeStepState {
  runs: Record<ClipStep, number>;
  inputs: Record<ClipStep, string>;
  failOnce: Partial<Record<ClipStep, boolean>>;
  llmActive: number;
  llmMaxActive: number;
}

const makeSteps = (state: FakeStepState): PipelineSteps => {
  const step = (name: ClipStep): PipelineStep => ({
    name,
    hash: () => state.inputs[name],
    isComplete: () => true,
    run: async () => {
      if (name === 'llm') {
        state.llmActive++;
        state.llmMaxActive = Math.max(state.llmMaxActive, state.llmActive);
      }
      await new Promise((r) => setTimeout(r, 5));
      if (name === 'llm') state.llmActive--;
      state.runs[name]++;
      if (state.failOnce[name]) {
        state.failOnce[name] = false;
        throw new Error(`${name} exploded`);
      }
      return {};
    },
  });
  return {
    frames: step('frames'),
    geo: step('geo'),
    tech: step('tech'),
    llm: step('llm'),
    cut: step('cut'),
  };
};

const only = <T>(items: T[]): T => {
  const [item] = items;
  if (!item) throw new Error('expected at least one item');
  return item;
};

const freshState = (): FakeStepState => ({
  runs: { frames: 0, geo: 0, tech: 0, llm: 0, cut: 0 },
  inputs: { frames: 'f', geo: 'g', tech: 't', llm: 'l', cut: 'c' },
  failOnce: {},
  llmActive: 0,
  llmMaxActive: 0,
});

const recorder = () => {
  const statuses: string[] = [];
  const events: PipelineEvents = {
    clipChanged: (c: ClipRecord) => statuses.push(`${c.segmentId}:${c.status}`),
    clipProgress: () => undefined,
    jobChanged: () => undefined,
  };
  return { statuses, events };
};

const setup = (
  opts: { autoApprove?: boolean; store?: MemoryStore; state?: FakeStepState } = {},
) => {
  const store = opts.store ?? new MemoryStore();
  const state = opts.state ?? freshState();
  const rec = recorder();
  const pipeline = new ExportPipeline({
    store,
    videos: fakeVideos(),
    steps: makeSteps(state),
    events: rec.events,
    log: silentLog,
    settings: settingsWith({ autoApprove: opts.autoApprove ?? false, concurrency: 3 }),
  });
  return { store, state, pipeline, rec };
};

describe('ExportPipeline', () => {
  it('runs every clip up to review, then cuts after approval', async () => {
    const { store, state, pipeline } = setup();
    const job = pipeline.start(manifest(3), '/m.json');
    await pipeline.onIdle();
    const clips = store.listClips(job.id);
    expect(clips.map((c) => c.status)).toEqual(['review', 'review', 'review']);
    expect(state.runs).toMatchObject({ frames: 3, geo: 3, tech: 3, llm: 3, cut: 0 });
    expect(clips[0]?.stepHashes).toEqual({ frames: 'f', geo: 'g', tech: 't', llm: 'l' });

    pipeline.approve(clips.map((c) => c.id));
    await pipeline.onIdle();
    expect(store.listClips(job.id).map((c) => c.status)).toEqual(['done', 'done', 'done']);
    expect(state.runs.cut).toBe(3);
  });

  it('never runs two LLM calls at once', async () => {
    const { state, pipeline } = setup({ autoApprove: true });
    pipeline.start(manifest(4), '/m.json');
    await pipeline.onIdle();
    expect(state.runs.llm).toBe(4);
    expect(state.llmMaxActive).toBe(1);
  });

  it('is idempotent: starting again does not duplicate clips', async () => {
    const { store, pipeline } = setup({ autoApprove: true });
    const job = pipeline.start(manifest(2), '/m.json');
    await pipeline.onIdle();
    pipeline.start(manifest(2), '/m.json');
    await pipeline.onIdle();
    expect(store.listClips(job.id)).toHaveLength(2);
  });

  it('discardJob deletes the job; starting again regenerates every clip from scratch', async () => {
    const { store, state, pipeline } = setup();
    const job = pipeline.start(manifest(2), '/m.json');
    await pipeline.onIdle();
    const [first] = store.listClips(job.id);
    if (first) await pipeline.setExcluded(first.id, true);

    await pipeline.discardJob(job.id);
    expect(store.getJob(job.id)).toBeUndefined();
    expect(store.listClips(job.id)).toEqual([]);

    const fresh = pipeline.start(manifest(2), '/m.json');
    await pipeline.onIdle();
    expect(fresh.id).not.toBe(job.id);
    const clips = store.listClips(fresh.id);
    expect(clips.map((c) => [c.status, c.excluded])).toEqual([
      ['review', false],
      ['review', false],
    ]);
    expect(state.runs).toMatchObject({ frames: 4, geo: 4, tech: 4, llm: 4 });
  });

  it('resumes after a restart from the interrupted step without re-running finished steps', async () => {
    const first = setup();
    const job = first.pipeline.start(manifest(1), '/m.json');
    await first.pipeline.onIdle();
    const clip = only(first.store.listClips(job.id));
    // Simulate a crash right after the geo step: status points at tech, hashes for frames+geo exist.
    first.store.updateClip(clip.id, { status: 'tech', stepHashes: { frames: 'f', geo: 'g' } });

    const state = freshState();
    const second = setup({ store: first.store, state });
    second.pipeline.resumeAll();
    await second.pipeline.onIdle();
    expect(state.runs).toMatchObject({ frames: 0, geo: 0, tech: 1, llm: 1 });
    expect(first.store.getClip(clip.id)?.status).toBe('review');
  });

  it('skips steps whose inputs are unchanged when re-running from an earlier step', async () => {
    const { store, state, pipeline } = setup({ autoApprove: true });
    const job = pipeline.start(manifest(1), '/m.json');
    await pipeline.onIdle();
    const clip = only(store.listClips(job.id));
    state.inputs.geo = 'g2'; // e.g. the user typed a location
    await pipeline.rerunFrom(clip.id, 'geo');
    await pipeline.onIdle();
    // geo changed; tech/llm/cut inputs (in this fake) did not.
    expect(state.runs).toMatchObject({ frames: 1, geo: 2, tech: 1, llm: 1, cut: 1 });
    expect(store.getClip(clip.id)?.status).toBe('done');
  });

  it('marks a failing step as failed and retries from that step', async () => {
    const state = freshState();
    state.failOnce.tech = true;
    const { store, pipeline } = setup({ state, autoApprove: true });
    const job = pipeline.start(manifest(1), '/m.json');
    await pipeline.onIdle();
    const clip = only(store.listClips(job.id));
    expect(clip).toMatchObject({ status: 'failed', failedStep: 'tech', error: 'tech exploded' });

    await pipeline.retry(clip.id);
    await pipeline.onIdle();
    expect(store.getClip(clip.id)?.status).toBe('done');
    expect(state.runs).toMatchObject({ frames: 1, geo: 1, tech: 2, llm: 1, cut: 1 });
  });

  it('regenerate re-runs only the LLM step and returns to review', async () => {
    const { store, state, pipeline } = setup();
    const job = pipeline.start(manifest(1), '/m.json');
    await pipeline.onIdle();
    const clip = only(store.listClips(job.id));
    await pipeline.regenerate(clip.id, { hint: 'This is Kazan Cathedral' });
    await pipeline.onIdle();
    expect(state.runs).toMatchObject({ frames: 1, geo: 1, tech: 1, llm: 2, cut: 0 });
    expect(store.getClip(clip.id)).toMatchObject({
      status: 'review',
      userHint: 'This is Kazan Cathedral',
    });
  });

  it('excluded clips are not processed', async () => {
    const { store, state, pipeline } = setup({ autoApprove: true });
    const job = pipeline.start(manifest(2), '/m.json');
    const first = only(store.listClips(job.id));
    await pipeline.setExcluded(first.id, true);
    await pipeline.onIdle();
    expect(state.runs.cut).toBe(1);
    expect(store.getClip(first.id)?.excluded).toBe(true);
  });
});
