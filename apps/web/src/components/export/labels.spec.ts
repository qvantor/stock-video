import { makeClip } from '../../test/utils';
import { clipStatusLabel, clipStatusTone, isAwaitingCut } from './labels';

describe('clip status labels', () => {
  it('uses the per-status label', () => {
    expect(clipStatusLabel(makeClip({ status: 'llm' }))).toBe('Writing metadata');
    expect(clipStatusLabel(makeClip({ status: 'review' }))).toBe('Needs review');
    expect(clipStatusTone(makeClip({ status: 'failed' }))).toBe('text-red-400');
  });

  it('marks approved review clips as waiting for encoding with the cut tone', () => {
    const clip = makeClip({ status: 'review', approved: true });
    expect(isAwaitingCut(clip)).toBe(true);
    expect(clipStatusLabel(clip)).toBe('Approved · waiting for encoding');
    expect(clipStatusTone(clip)).toBe(clipStatusTone(makeClip({ status: 'cut' })));
  });

  it('excluded wins over every other label', () => {
    const clip = makeClip({ status: 'review', approved: true, excluded: true });
    expect(isAwaitingCut(clip)).toBe(false);
    expect(clipStatusLabel(clip)).toBe('Excluded');
    expect(clipStatusLabel(makeClip({ status: 'done', excluded: true }))).toBe('Excluded');
  });

  it('is not awaiting cut once encoding started or when not approved', () => {
    expect(isAwaitingCut(makeClip({ status: 'cut', approved: true }))).toBe(false);
    expect(isAwaitingCut(makeClip({ status: 'review', approved: false }))).toBe(false);
  });
});
