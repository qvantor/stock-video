import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { StorageCleanupResultSchema, StorageUsageSchema } from '@dfs/contracts';
import type { Services } from '../services/container.js';

export const storageRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/storage', { schema: { response: { 200: StorageUsageSchema } } }, () =>
      s.storage.usage(),
    );

    app.post(
      '/storage/cleanup',
      { schema: { response: { 200: StorageCleanupResultSchema } } },
      () => s.storage.cleanup(),
    );
  };
