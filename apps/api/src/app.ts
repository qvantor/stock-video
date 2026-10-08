import Fastify, { type FastifyInstance } from 'fastify';
import { SystemStatusSchema } from '@dfs/contracts';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { HttpError } from './lib/errors.js';
import { eventRoutes } from './routes/events.js';
import { exportRoutes } from './routes/export.js';
import { mediaRoutes } from './routes/media.js';
import { projectRoutes } from './routes/projects.js';
import { segmentRoutes } from './routes/segments.js';
import { storageRoutes } from './routes/storage.js';
import { uploadRoutes } from './routes/uploads.js';
import { videoRoutes } from './routes/videos.js';
import { createServices, type ServiceOverrides, type Services } from './services/container.js';

const API_PREFIX = '/api';

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
}

export const buildApp = async (
  config: AppConfig,
  db: Db,
  overrides: ServiceOverrides = {},
): Promise<BuiltApp> => {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Large uploads go through tus in chunks; JSON bodies stay small.
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: 'Invalid request', details: err.validation });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error(err);
    const status =
      typeof err === 'object' && err && 'statusCode' in err ? Number(err.statusCode) : 500;
    const message = err instanceof Error ? err.message : 'Internal error';
    return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: message });
  });

  const services = createServices(config, db, app.log, overrides);

  app.get(`${API_PREFIX}/health`, () => ({ ok: true }));
  app.get(`${API_PREFIX}/status`, { schema: { response: { 200: SystemStatusSchema } } }, () =>
    services.status.check(),
  );
  await app.register(projectRoutes(services), { prefix: API_PREFIX });
  await app.register(videoRoutes(services), { prefix: API_PREFIX });
  await app.register(segmentRoutes(services), { prefix: API_PREFIX });
  await app.register(eventRoutes(services), { prefix: API_PREFIX });
  await app.register(exportRoutes(services), { prefix: API_PREFIX });
  await app.register(storageRoutes(services), { prefix: API_PREFIX });
  await app.register(uploadRoutes(services.tus));
  await app.register(mediaRoutes(services.paths));

  return { app, services };
};
