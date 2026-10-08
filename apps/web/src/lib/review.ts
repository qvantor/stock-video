import type { SourceVideo } from '@dfs/contracts';

/** Ready videos the user has not checked yet, in project order. */
export const reviewQueue = (videos: readonly SourceVideo[]): SourceVideo[] =>
  videos.filter((v) => v.status === 'ready' && !v.reviewed);

/**
 * Where the editor's "Next" button goes from `currentId`: the first unchecked video while any
 * remain, otherwise the next ready video in project order. Undefined on the last one.
 */
export const nextVideo = (
  videos: readonly SourceVideo[],
  currentId: string,
): SourceVideo | undefined =>
  reviewQueue(videos).find((v) => v.id !== currentId) ?? nextReady(videos, currentId);

/** The ready video after `currentId` in project order, or undefined on the last one. */
export const nextReady = (
  videos: readonly SourceVideo[],
  currentId: string,
): SourceVideo | undefined => {
  const ready = videos.filter((v) => v.status === 'ready');
  const index = ready.findIndex((v) => v.id === currentId);
  return index === -1 ? undefined : ready[index + 1];
};
