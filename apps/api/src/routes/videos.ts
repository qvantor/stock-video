import fs from 'node:fs/promises';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  DuplicateCheckRequestSchema,
  DuplicateCheckResponseSchema,
  ReanalyzeBodySchema,
  SetVideoReviewedBodySchema,
  SourceVideoSchema,
  UpdateSettingsBodySchema,
  VideoMetricsSchema,
  type ExistingVideoInfo,
} from '@dfs/contracts';
import { conflict, notFound } from '../lib/errors.js';
import type { Services } from '../services/container.js';

const IdParams = z.object({ id: z.string() });

export const videoRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/projects/:id/videos',
      {
        schema: {
          params: IdParams,
          response: { 200: z.array(SourceVideoSchema) },
        },
      },
      (req) => {
        s.projects.get(req.params.id);
        return s.videos.listByProject(req.params.id);
      },
    );

    // Before uploading: are any of these files already stored (in any project)?
    app.post(
      '/videos/duplicates',
      {
        schema: {
          body: DuplicateCheckRequestSchema,
          response: { 200: DuplicateCheckResponseSchema },
        },
      },
      (req) => {
        const matches: Record<string, ExistingVideoInfo[]> = {};
        for (const file of req.body.files) {
          const found = s.videos.findUploadDuplicates(file);
          if (found.length > 0) matches[file.key] = found;
        }
        return { matches };
      },
    );

    app.get(
      '/videos/:id',
      { schema: { params: IdParams, response: { 200: SourceVideoSchema } } },
      (req) => s.videos.get(req.params.id),
    );

    app.delete('/videos/:id', { schema: { params: IdParams } }, async (req, reply) => {
      const video = s.videos.get(req.params.id);
      s.projects.assertEditable(video.projectId);
      await s.queue.cancel(video.id);
      await s.videos.remove(video.id);
      return reply.code(204).send();
    });

    app.put(
      '/videos/:id/reviewed',
      {
        schema: {
          params: IdParams,
          body: SetVideoReviewedBodySchema,
          response: { 200: SourceVideoSchema },
        },
      },
      (req) => {
        const video = s.videos.get(req.params.id);
        s.projects.assertEditable(video.projectId);
        return s.videos.update(video.id, { reviewed: req.body.reviewed });
      },
    );

    app.post(
      '/videos/:id/retry',
      { schema: { params: IdParams, response: { 200: SourceVideoSchema } } },
      (req) => {
        const video = s.videos.get(req.params.id);
        s.projects.assertEditable(video.projectId);
        if (video.status !== 'failed') throw conflict('Only failed videos can be retried');
        if (!video.storedPath)
          throw conflict('The file was not uploaded completely — upload it again');
        s.queue.enqueue(video.id);
        return s.videos.get(video.id);
      },
    );

    app.post(
      '/videos/:id/reanalyze',
      {
        schema: {
          params: IdParams,
          body: ReanalyzeBodySchema,
          response: {
            200: z.object({ mode: z.enum(['segmented', 'queued']), video: SourceVideoSchema }),
          },
        },
      },
      async (req) => {
        const video = s.videos.get(req.params.id);
        const project = s.projects.assertEditable(video.projectId);
        if (video.status !== 'ready') throw conflict('The video has not been processed yet');
        const settings = req.body.settings ?? project.analysisSettings;
        const mode = await s.analysis.reanalyze(video.id, settings, (id) => s.queue.enqueue(id));
        return { mode, video: s.videos.get(video.id) };
      },
    );

    app.post(
      '/projects/:id/reanalyze',
      {
        schema: {
          params: IdParams,
          body: UpdateSettingsBodySchema,
          response: { 200: z.object({ segmented: z.number(), queued: z.number() }) },
        },
      },
      async (req) => {
        const project = s.projects.updateSettings(req.params.id, req.body);
        let segmented = 0;
        let queued = 0;
        for (const v of s.videos.listByProject(project.id)) {
          if (v.status !== 'ready') continue;
          const mode = await s.analysis.reanalyze(v.id, project.analysisSettings, (id) =>
            s.queue.enqueue(id),
          );
          if (mode === 'segmented') segmented++;
          else queued++;
        }
        return { segmented, queued };
      },
    );

    app.get(
      '/videos/:id/metrics',
      { schema: { params: IdParams, response: { 200: VideoMetricsSchema } } },
      async (req) => {
        s.videos.getRow(req.params.id);
        try {
          return VideoMetricsSchema.parse(
            JSON.parse(await fs.readFile(s.paths.metrics(req.params.id), 'utf8')),
          );
        } catch {
          throw notFound('Metrics');
        }
      },
    );
  };
