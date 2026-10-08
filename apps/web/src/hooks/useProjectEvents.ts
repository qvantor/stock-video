import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ProjectEventSchema, type SourceVideo } from '@dfs/contracts';
import { applyClipProgress, applyClips, applyJob, exportKeys } from '../api/export';
import { forgetProject, projectKeys } from '../api/projects';
import { segmentKeys } from '../api/segments';
import { videoKeys } from '../api/videos';

const EVENT_TYPES = [
  'video.progress',
  'video.updated',
  'video.deleted',
  'segments.updated',
  'project.updated',
  'project.deleted',
  'export.updated',
  'export.reset',
  'export.clip.updated',
  'export.clip.progress',
];

/** Subscribe to the project's SSE stream and apply events to the query cache. */
export const useProjectEvents = (projectId: string): void => {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`);
    const listKey = videoKeys.list(projectId);
    const patchVideos = (fn: (list: SourceVideo[]) => SourceVideo[]) =>
      qc.setQueryData<SourceVideo[]>(listKey, (old) => (old ? fn(old) : old));

    const onMessage = (msg: MessageEvent<string>) => {
      const parsed = ProjectEventSchema.safeParse(JSON.parse(msg.data));
      if (!parsed.success) return;
      const event = parsed.data;
      switch (event.type) {
        case 'video.progress':
          patchVideos((list) =>
            list.map((v) =>
              v.id === event.videoId ? { ...v, status: event.status, progress: event.progress } : v,
            ),
          );
          break;
        case 'video.updated': {
          void qc.invalidateQueries({ queryKey: segmentKeys.summary(projectId) });
          const known = qc
            .getQueryData<SourceVideo[]>(listKey)
            ?.some((v) => v.id === event.video.id);
          if (known)
            patchVideos((list) => list.map((v) => (v.id === event.video.id ? event.video : v)));
          else void qc.invalidateQueries({ queryKey: listKey });
          if (event.video.status === 'ready') {
            void qc.invalidateQueries({
              queryKey: segmentKeys.list(event.video.id),
            });
            void qc.invalidateQueries({
              queryKey: videoKeys.metrics(event.video.id),
            });
          }
          break;
        }
        case 'video.deleted':
          patchVideos((list) => list.filter((v) => v.id !== event.videoId));
          void qc.invalidateQueries({ queryKey: segmentKeys.summary(projectId) });
          break;
        case 'segments.updated':
          void qc.invalidateQueries({
            queryKey: segmentKeys.list(event.videoId),
          });
          void qc.invalidateQueries({
            queryKey: segmentKeys.summary(projectId),
          });
          break;
        case 'project.deleted':
          // Deleted (possibly in another tab): leave the project's pages.
          forgetProject(qc, projectId);
          navigate('/', { replace: true });
          break;
        case 'project.updated':
          qc.setQueryData(projectKeys.one(projectId), event.project);
          void qc.invalidateQueries({ queryKey: segmentKeys.summary(projectId) });
          break;
        case 'export.updated':
          if (qc.getQueryData(exportKeys.state(projectId))) applyJob(qc, projectId, event.job);
          else void qc.invalidateQueries({ queryKey: exportKeys.state(projectId) });
          break;
        case 'export.reset':
          // The old job and its clips are gone; a new job (if any) arrives via refetch.
          void qc.invalidateQueries({ queryKey: exportKeys.state(projectId) });
          break;
        case 'export.clip.updated': {
          const known = qc
            .getQueryData<{ clips: { id: string }[] } | null>(exportKeys.state(projectId))
            ?.clips.some((c) => c.id === event.clip.id);
          if (known) applyClips(qc, projectId, [event.clip]);
          else void qc.invalidateQueries({ queryKey: exportKeys.state(projectId) });
          break;
        }
        case 'export.clip.progress':
          applyClipProgress(qc, projectId, event.clipId, {
            status: event.status,
            progress: event.progress,
          });
          break;
      }
    };

    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage);
    // After a reconnect we may have missed events — refetch.
    source.addEventListener('open', () => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: exportKeys.state(projectId) });
    });
    return () => source.close();
  }, [projectId, qc, navigate]);
};
