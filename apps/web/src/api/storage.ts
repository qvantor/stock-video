import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StorageCleanupResultSchema, StorageUsageSchema } from '@dfs/contracts';
import { apiRequest } from './client';
import { projectKeys } from './projects';
import { statusKeys } from './status';

const storageKeys = {
  all: ['storage'] as const,
};

/** Disk usage; refreshed more often while the storage panel is open. */
export const useStorageUsage = (open: boolean) =>
  useQuery({
    queryKey: storageKeys.all,
    queryFn: () => apiRequest(StorageUsageSchema, '/storage'),
    refetchInterval: open ? 10_000 : 120_000,
    retry: false,
  });

/** Delete encoded clips and archives; export states change, so all project data is refetched. */
export const useStorageCleanup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(StorageCleanupResultSchema, '/storage/cleanup', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storageKeys.all });
      void qc.invalidateQueries({ queryKey: projectKeys.all });
      void qc.invalidateQueries({ queryKey: statusKeys.all });
    },
  });
};
