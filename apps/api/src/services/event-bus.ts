import { EventEmitter } from 'node:events';
import type { ProjectEvent } from '@dfs/contracts';

type Listener = (event: ProjectEvent) => void;

/** In-process pub/sub for per-project SSE streams. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(projectId: string, event: ProjectEvent): void {
    this.emitter.emit(projectId, event);
  }

  subscribe(projectId: string, listener: Listener): () => void {
    this.emitter.on(projectId, listener);
    return () => this.emitter.off(projectId, listener);
  }
}
