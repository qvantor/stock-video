import type { ProjectEvent } from '@dfs/contracts';
import { EventBus } from './event-bus.js';

const event = (videoId: string): ProjectEvent => ({ type: 'video.deleted', videoId });

describe('EventBus', () => {
  it('delivers events only to subscribers of the same project', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('p1', a);
    bus.subscribe('p2', b);

    bus.publish('p1', event('v1'));

    expect(a).toHaveBeenCalledWith(event('v1'));
    expect(b).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const other = vi.fn();
    const unsubscribe = bus.subscribe('p1', a);
    bus.subscribe('p1', other);

    unsubscribe();
    bus.publish('p1', event('v1'));

    expect(a).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('supports many subscribers without a max-listeners warning', () => {
    const bus = new EventBus();
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const listeners = Array.from({ length: 50 }, () => vi.fn());
    for (const l of listeners) bus.subscribe('p1', l);

    bus.publish('p1', event('v1'));

    expect(listeners.every((l) => l.mock.calls.length === 1)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
