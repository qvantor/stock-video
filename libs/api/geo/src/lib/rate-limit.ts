import PQueue from 'p-queue';

/** Serialises calls to at most `perInterval` per `intervalMs` (Nominatim policy: 1 request/second). */
export class RateLimiter {
  private readonly queue: PQueue;

  constructor(perInterval = 1, intervalMs = 1000) {
    this.queue = new PQueue({ concurrency: 1, intervalCap: perInterval, interval: intervalMs });
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn) as Promise<T>;
  }
}
