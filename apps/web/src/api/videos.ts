import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  DuplicateCheckResponseSchema,
  SourceVideoSchema,
  VideoMetricsSchema,
  type DuplicateCheckRequest,
  type DuplicateCheckResponse,
  type SetVideoReviewedBody,
  type SourceVideo,
} from '@dfs/contracts';
import { apiRequest } from './client';

export const videoKeys = {
  list: (projectId: string) => ['projects', projectId, 'videos'] as const,
  metrics: (videoId: string) => ['videos', videoId, 'metrics'] as const,
};

export const useVideos = (projectId: string) =>
  useQuery({
    queryKey: videoKeys.list(projectId),
    queryFn: () => apiRequest(z.array(SourceVideoSchema), `/projects/${projectId}/videos`),
  });

export const useVideo = (projectId: string, videoId: string): SourceVideo | undefined => {
  const { data } = useVideos(projectId);
  return data?.find((v) => v.id === videoId);
};

export const useVideoMetrics = (videoId: string, enabled: boolean) =>
  useQuery({
    queryKey: videoKeys.metrics(videoId),
    queryFn: () => apiRequest(VideoMetricsSchema, `/videos/${videoId}/metrics`),
    enabled,
    retry: false,
  });

export const useRetryVideo = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) =>
      apiRequest(SourceVideoSchema, `/videos/${videoId}/retry`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: videoKeys.list(projectId) }),
  });
};

export const useDeleteVideo = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) =>
      apiRequest(z.unknown(), `/videos/${videoId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: videoKeys.list(projectId) }),
  });
};

export const useSetVideoReviewed = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, reviewed }: { videoId: string } & SetVideoReviewedBody) =>
      apiRequest(SourceVideoSchema, `/videos/${videoId}/reviewed`, {
        method: 'PUT',
        body: { reviewed },
      }),
    // Update the cache right away so the review flow picks the next video from fresh data.
    onSuccess: (video) =>
      qc.setQueryData<SourceVideo[]>(videoKeys.list(projectId), (list) =>
        list?.map((v) => (v.id === video.id ? video : v)),
      ),
  });
};

/** Which of these files are already stored (in any project). */
export const checkDuplicates = (body: DuplicateCheckRequest): Promise<DuplicateCheckResponse> =>
  apiRequest(DuplicateCheckResponseSchema, '/videos/duplicates', { method: 'POST', body });
