import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveSegments, segmentKeys } from '../api/segments';
import { useEditorStore } from './store';

const DEBOUNCE_MS = 1000;

/** Persist the editor's segments with PUT /videos/:id/segments, debounced. */
export const useAutosave = (videoId: string, projectId: string, enabled: boolean): void => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    let inFlight = false;

    const save = async () => {
      timer = null;
      const s = useEditorStore.getState();
      if (s.videoId !== videoId || s.revision === s.savedRevision || inFlight) return;
      const revision = s.revision;
      inFlight = true;
      s.markSaving();
      try {
        const saved = await saveSegments(videoId, s.segments);
        qc.setQueryData(segmentKeys.list(videoId), saved);
        void qc.invalidateQueries({ queryKey: segmentKeys.summary(projectId) });
        useEditorStore.getState().markSaved(revision);
      } catch (err) {
        useEditorStore.getState().markSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const schedule = () => {
      const s = useEditorStore.getState();
      if (s.revision === s.savedRevision || inFlight) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), DEBOUNCE_MS);
    };

    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.revision !== prev.revision) schedule();
    });

    // Flush pending edits when leaving the page.
    const flush = () => {
      const s = useEditorStore.getState();
      if (s.videoId !== videoId || s.revision === s.savedRevision) return;
      void fetch(`/api/videos/${videoId}/segments`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segments: s.segments }),
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', flush);

    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', flush);
      if (timer !== null) {
        window.clearTimeout(timer);
        flush();
      }
    };
  }, [videoId, projectId, enabled, qc]);
};
