import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProjectSummarySchema, PutSegmentsBodySchema, SegmentSchema } from '@dfs/contracts';
import type { Services } from '../services/container.js';

const IdParams = z.object({ id: z.string() });

export const segmentRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/videos/:id/segments',
      {
        schema: { params: IdParams, response: { 200: z.array(SegmentSchema) } },
      },
      (req) => {
        s.videos.getRow(req.params.id);
        return s.segments.list(req.params.id);
      },
    );

    app.put(
      '/videos/:id/segments',
      {
        schema: {
          params: IdParams,
          body: PutSegmentsBodySchema,
          response: { 200: z.array(SegmentSchema) },
        },
      },
      (req) => s.segments.replace(req.params.id, req.body.segments),
    );

    app.get(
      '/projects/:id/summary',
      { schema: { params: IdParams, response: { 200: ProjectSummarySchema } } },
      (req) => s.segments.summary(req.params.id),
    );
  };
