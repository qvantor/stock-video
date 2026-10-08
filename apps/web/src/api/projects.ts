import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ConfirmResponseSchema,
  ProjectListItemSchema,
  ProjectSchema,
  isVideoSettled,
  type AnalysisSettings,
  type ProjectListItem,
  type VideoStatus,
} from '@dfs/contracts';
import { apiRequest } from './client';

export const projectKeys = {
  all: ['projects'] as const,
  one: (id: string) => ['projects', id] as const,
};

const PROCESSING_POLL_MS = 3000;

const isProcessing = (p: ProjectListItem): boolean =>
  Object.keys(p.overview.statusCounts).some((s) => !isVideoSettled(s as VideoStatus));

export const useProjects = () =>
  useQuery({
    queryKey: projectKeys.all,
    queryFn: () => apiRequest(z.array(ProjectListItemSchema), '/projects'),
    // Keep counts and previews fresh while any video is still being processed.
    refetchInterval: (q) => (q.state.data?.some(isProcessing) ? PROCESSING_POLL_MS : false),
  });

export const useProject = (id: string) =>
  useQuery({
    queryKey: projectKeys.one(id),
    queryFn: () => apiRequest(ProjectSchema, `/projects/${id}`),
  });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest(ProjectSchema, '/projects', {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
};

export const useUpdateSettings = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: AnalysisSettings) =>
      apiRequest(ProjectSchema, `/projects/${projectId}/settings`, {
        method: 'PUT',
        body: settings,
      }),
    onSuccess: (project) => qc.setQueryData(projectKeys.one(projectId), project),
  });
};

export const useReanalyzeProject = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: AnalysisSettings) =>
      apiRequest(
        z.object({ segmented: z.number(), queued: z.number() }),
        `/projects/${projectId}/reanalyze`,
        { method: 'POST', body: settings },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.one(projectId) });
      void qc.invalidateQueries({ queryKey: ['projects', projectId] });
      void qc.invalidateQueries({ queryKey: ['videos'] });
    },
  });
};

export const useConfirmProject = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(ConfirmResponseSchema, `/projects/${projectId}/confirm`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

/** Back to draft; the project's export is discarded on the server. */
export const useReopenProject = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(ProjectSchema, `/projects/${projectId}/reopen`, { method: 'POST' }),
    onSuccess: (project) => {
      qc.setQueryData(projectKeys.one(projectId), project);
      qc.removeQueries({ queryKey: ['projects', projectId, 'export'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

/** Drop a deleted project from the cache (list updated immediately, details removed). */
export const forgetProject = (qc: QueryClient, projectId: string): void => {
  qc.setQueryData<ProjectListItem[]>(projectKeys.all, (list) =>
    list?.filter((p) => p.id !== projectId),
  );
  qc.removeQueries({ queryKey: ['projects', projectId] });
  void qc.invalidateQueries({ queryKey: projectKeys.all });
};

export const useDeleteProject = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(z.unknown(), `/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      forgetProject(qc, projectId);
    },
  });
};
