import { useQuery } from '@tanstack/react-query';
import { SystemStatusSchema } from '@dfs/contracts';
import { apiRequest } from './client';

export const statusKeys = {
  all: ['status'] as const,
};

export const useSystemStatus = () =>
  useQuery({
    queryKey: statusKeys.all,
    queryFn: () => apiRequest(SystemStatusSchema, '/status'),
    refetchInterval: 30_000,
    retry: false,
  });
