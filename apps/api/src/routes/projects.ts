import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ConfirmResponseSchema,
  CreateProjectBodySchema,
  ProjectListItemSchema,
  ProjectSchema,
  UpdateSettingsBodySchema,
} from '@dfs/contracts';
import type { Services } from '../services/container.js';

const IdParams = z.object({ id: z.string() });

export const projectRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/projects', { schema: { response: { 200: z.array(ProjectListItemSchema) } } }, () =>
      s.projects.list(),
    );

    app.post(
      '/projects',
      {
        schema: {
          body: CreateProjectBodySchema,
          response: { 201: ProjectSchema },
        },
      },
      async (req, reply) => reply.code(201).send(s.projects.create(req.body.name)),
    );

    app.get(
      '/projects/:id',
      { schema: { params: IdParams, response: { 200: ProjectSchema } } },
      (req) => s.projects.get(req.params.id),
    );

    app.put(
      '/projects/:id/settings',
      {
        schema: {
          params: IdParams,
          body: UpdateSettingsBodySchema,
          response: { 200: ProjectSchema },
        },
      },
      (req) => s.projects.updateSettings(req.params.id, req.body),
    );

    app.post(
      '/projects/:id/confirm',
      { schema: { params: IdParams, response: { 200: ConfirmResponseSchema } } },
      (req) => s.confirm.confirm(req.params.id),
    );

    app.post(
      '/projects/:id/reopen',
      { schema: { params: IdParams, response: { 200: ProjectSchema } } },
      (req) => s.confirm.reopen(req.params.id),
    );

    app.delete('/projects/:id', { schema: { params: IdParams } }, async (req, reply) => {
      await s.projectDeletion.delete(req.params.id);
      return reply.code(204).send();
    });
  };
