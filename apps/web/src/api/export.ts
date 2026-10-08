import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ExportClipSchema,
  ExportJobSchema,
  ExportSettingsSchema,
  ExportStateSchema,
  OllamaHealthSchema,
  StockCategoriesSchema,
  StockPlatformInfoSchema,
  type BulkKeywordsBody,
  type ClipMetadataPatch,
  type ExportClip,
  type ExportJob,
  type ExportSettings,
  type ExportState,
  type RegenerateBody,
} from '@dfs/contracts';
import { ApiError, apiRequest } from './client';
import { statusKeys } from './status';

export const exportKeys = {
  state: (projectId: string) => ['projects', projectId, 'export'] as const,
  health: ['export', 'health'] as const,
  settings: ['settings', 'export'] as const,
  platforms: ['stock', 'platforms'] as const,
  categories: ['stock', 'categories'] as const,
};

/** Export state; `null` when the project has no export job yet. */
export const useExportState = (projectId: string) =>
  useQuery({
    queryKey: exportKeys.state(projectId),
    queryFn: async () => {
      try {
        return await apiRequest(ExportStateSchema, `/projects/${projectId}/export`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });

const patchState = (qc: QueryClient, projectId: string, fn: (s: ExportState) => ExportState) =>
  qc.setQueryData<ExportState | null>(exportKeys.state(projectId), (old) => (old ? fn(old) : old));

/** Replace clips in the cached state. */
export const applyClips = (qc: QueryClient, projectId: string, clips: ExportClip[]) => {
  const byId = new Map(clips.map((c) => [c.id, c]));
  patchState(qc, projectId, (s) => ({ ...s, clips: s.clips.map((c) => byId.get(c.id) ?? c) }));
};

export const applyJob = (qc: QueryClient, projectId: string, job: ExportJob) =>
  patchState(qc, projectId, (s) => ({ ...s, job }));

export const applyClipProgress = (
  qc: QueryClient,
  projectId: string,
  clipId: string,
  patch: Pick<ExportClip, 'status' | 'progress'>,
) =>
  patchState(qc, projectId, (s) => ({
    ...s,
    clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
  }));

export const useStartExport = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(ExportStateSchema, `/projects/${projectId}/export`, { method: 'POST' }),
    onSuccess: (state) => qc.setQueryData(exportKeys.state(projectId), state),
  });
};

/** Discard the export and run every clip through the whole pipeline again. */
export const useRegenerateAll = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(ExportStateSchema, `/projects/${projectId}/export/regenerate`, {
        method: 'POST',
      }),
    onSuccess: (state) => qc.setQueryData(exportKeys.state(projectId), state),
  });
};

const useClipMutation = <V>(
  projectId: string,
  request: (vars: V) => Promise<ExportClip | ExportClip[]>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (result) => applyClips(qc, projectId, Array.isArray(result) ? result : [result]),
  });
};

export const usePatchMetadata = (projectId: string) =>
  useClipMutation(projectId, ({ clipId, patch }: { clipId: string; patch: ClipMetadataPatch }) =>
    apiRequest(ExportClipSchema, `/clips/${clipId}/metadata`, { method: 'PATCH', body: patch }),
  );

export const useBulkKeywords = (projectId: string) =>
  useClipMutation(projectId, (body: BulkKeywordsBody) =>
    apiRequest(z.array(ExportClipSchema), '/clips/keywords', { method: 'POST', body }),
  );

export const useRegenerate = (projectId: string) =>
  useClipMutation(projectId, ({ clipId, body }: { clipId: string; body: RegenerateBody }) =>
    apiRequest(ExportClipSchema, `/clips/${clipId}/regenerate`, { method: 'POST', body }),
  );

export const useRetryClip = (projectId: string) =>
  useClipMutation(projectId, (clipId: string) =>
    apiRequest(ExportClipSchema, `/clips/${clipId}/retry`, { method: 'POST' }),
  );

export const useApprove = (projectId: string) =>
  useClipMutation(projectId, (clipIds: string[]) =>
    apiRequest(z.array(ExportClipSchema), '/clips/approve', { method: 'POST', body: { clipIds } }),
  );

export const useExclude = (projectId: string) =>
  useClipMutation(projectId, ({ clipId, excluded }: { clipId: string; excluded: boolean }) =>
    apiRequest(ExportClipSchema, `/clips/${clipId}/exclude`, {
      method: 'POST',
      body: { excluded },
    }),
  );

export const useSetVideoLocation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, location }: { videoId: string; location: string | null }) =>
      apiRequest(z.unknown(), `/videos/${videoId}/location`, {
        method: 'PATCH',
        body: { location },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: exportKeys.state(projectId) }),
  });
};

export const useBuildArchive = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(ExportJobSchema, `/projects/${projectId}/export/build`, { method: 'POST' }),
    onSuccess: (job) => applyJob(qc, projectId, job),
  });
};

export const useExportHealth = () =>
  useQuery({
    queryKey: exportKeys.health,
    queryFn: () => apiRequest(OllamaHealthSchema, '/export/health'),
    refetchInterval: (q) => (q.state.data?.ok ? false : 15_000),
  });

export const useExportSettings = () =>
  useQuery({
    queryKey: exportKeys.settings,
    queryFn: () => apiRequest(ExportSettingsSchema, '/settings/export'),
  });

export const useSaveExportSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: ExportSettings) =>
      apiRequest(ExportSettingsSchema, '/settings/export', { method: 'PUT', body: settings }),
    onSuccess: (settings) => {
      qc.setQueryData(exportKeys.settings, settings);
      void qc.invalidateQueries({ queryKey: exportKeys.health });
      void qc.invalidateQueries({ queryKey: statusKeys.all });
    },
  });
};

export const useStockPlatforms = () =>
  useQuery({
    queryKey: exportKeys.platforms,
    queryFn: () => apiRequest(z.array(StockPlatformInfoSchema), '/stock-platforms'),
    staleTime: Infinity,
  });

export const useStockCategories = () =>
  useQuery({
    queryKey: exportKeys.categories,
    queryFn: () => apiRequest(StockCategoriesSchema, '/stock-categories'),
    staleTime: Infinity,
  });
