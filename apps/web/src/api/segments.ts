import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ProjectSummarySchema, SegmentSchema, type Segment } from '@dfs/contracts';
import { apiRequest } from './client';

export const segmentKeys = {
  list: (videoId: string) => ['videos', videoId, 'segments'] as const,
  summary: (projectId: string) => ['projects', projectId, 'summary'] as const,
};

const fetchSegments = (videoId: string) =>
  apiRequest(z.array(SegmentSchema), `/videos/${videoId}/segments`);

export const saveSegments = (videoId: string, segments: Segment[]) =>
  apiRequest(z.array(SegmentSchema), `/videos/${videoId}/segments`, {
    method: 'PUT',
    body: { segments },
  });

export const useSegments = (videoId: string, enabled = true) =>
  useQuery({
    queryKey: segmentKeys.list(videoId),
    queryFn: () => fetchSegments(videoId),
    enabled,
  });

export const useProjectSummary = (projectId: string) =>
  useQuery({
    queryKey: segmentKeys.summary(projectId),
    queryFn: () => apiRequest(ProjectSummarySchema, `/projects/${projectId}/summary`),
  });
