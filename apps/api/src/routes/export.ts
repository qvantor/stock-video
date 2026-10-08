import fs from 'node:fs';
import path from 'node:path';
import send from '@fastify/send';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  BulkKeywordsBodySchema,
  ClipIdsBodySchema,
  ClipMetadataPatchSchema,
  ExcludeBodySchema,
  ExportClipSchema,
  ExportJobSchema,
  ExportSettingsSchema,
  ExportStateSchema,
  OllamaHealthSchema,
  StockCategoriesSchema,
  StockPlatformInfoSchema,
  RegenerateBodySchema,
  VideoLocationBodySchema,
} from '@dfs/contracts';
import { badRequest, notFound } from '../lib/errors.js';
import type { Services } from '../services/container.js';

const IdParams = z.object({ id: z.string() });

/** Stage-2 export: pipeline state, clip edits, settings and archive download. */
export const exportRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/projects/:id/export',
      { schema: { params: IdParams, response: { 200: ExportStateSchema } } },
      (req) => s.exports.start(req.params.id),
    );

    app.post(
      '/projects/:id/export/regenerate',
      { schema: { params: IdParams, response: { 200: ExportStateSchema } } },
      (req) => s.exports.regenerateAll(req.params.id),
    );

    app.get(
      '/projects/:id/export',
      { schema: { params: IdParams, response: { 200: ExportStateSchema } } },
      (req) => s.exports.state(req.params.id),
    );

    app.patch(
      '/clips/:id/metadata',
      {
        schema: {
          params: IdParams,
          body: ClipMetadataPatchSchema,
          response: { 200: ExportClipSchema },
        },
      },
      (req) => s.exports.patchMetadata(req.params.id, req.body),
    );

    app.post(
      '/clips/keywords',
      { schema: { body: BulkKeywordsBodySchema, response: { 200: z.array(ExportClipSchema) } } },
      (req) => s.exports.bulkKeywords(req.body),
    );

    app.post(
      '/clips/:id/regenerate',
      {
        schema: {
          params: IdParams,
          body: RegenerateBodySchema,
          response: { 200: ExportClipSchema },
        },
      },
      (req) => s.exports.regenerate(req.params.id, req.body),
    );

    app.post(
      '/clips/:id/retry',
      { schema: { params: IdParams, response: { 200: ExportClipSchema } } },
      (req) => s.exports.retry(req.params.id),
    );

    app.post(
      '/clips/approve',
      { schema: { body: ClipIdsBodySchema, response: { 200: z.array(ExportClipSchema) } } },
      (req) => s.exports.approve(req.body.clipIds),
    );

    app.post(
      '/clips/:id/exclude',
      {
        schema: { params: IdParams, body: ExcludeBodySchema, response: { 200: ExportClipSchema } },
      },
      (req) => s.exports.setExcluded(req.params.id, req.body.excluded),
    );

    app.patch(
      '/videos/:id/location',
      { schema: { params: IdParams, body: VideoLocationBodySchema } },
      async (req, reply) => {
        await s.exports.setVideoLocation(req.params.id, req.body.location);
        return reply.code(204).send();
      },
    );

    app.get(
      '/clips/:id/frames/:index',
      {
        schema: {
          params: z.object({ id: z.string(), index: z.coerce.number().int().min(0).max(9) }),
          querystring: z.object({ variant: z.enum(['full', 'llm']).default('full') }),
        },
      },
      async (req, reply) => {
        const clip = s.exports.getClipRecord(req.params.id);
        const dir = s.paths.clipWork(clip.jobId, clip.id);
        const file = `frame_${req.params.index}${req.query.variant === 'llm' ? '_llm' : ''}.jpg`;
        if (!fs.existsSync(path.join(dir, file))) throw notFound('Frame');
        const result = await send(req.raw, `/${file}`, { root: dir, cacheControl: false });
        if (result.type === 'error')
          return reply.code(result.statusCode).send({ error: 'File not found' });
        return reply
          .code(result.statusCode)
          .headers({ ...result.headers, 'cache-control': 'no-cache' })
          .send(result.stream);
      },
    );

    app.post(
      '/projects/:id/export/build',
      { schema: { params: IdParams, response: { 202: ExportJobSchema } } },
      async (req, reply) => reply.code(202).send(s.exports.startBuild(req.params.id)),
    );

    app.get('/exports/:id/download', { schema: { params: IdParams } }, async (req, reply) => {
      const zip = s.exports.zipPath(req.params.id);
      const result = await send(req.raw, `/${path.basename(zip)}`, {
        root: path.dirname(zip),
        acceptRanges: true,
        etag: true,
        lastModified: true,
        cacheControl: false,
      });
      if (result.type === 'error')
        return reply.code(result.statusCode).send({ error: 'File not found' });
      return reply
        .code(result.statusCode)
        .headers({
          ...result.headers,
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${path.basename(zip)}"`,
        })
        .send(result.stream);
    });

    app.get('/export/health', { schema: { response: { 200: OllamaHealthSchema } } }, () =>
      s.exports.health(),
    );

    app.get(
      '/stock-platforms',
      { schema: { response: { 200: z.array(StockPlatformInfoSchema) } } },
      () => s.exports.platforms(),
    );

    app.get('/stock-categories', { schema: { response: { 200: StockCategoriesSchema } } }, () =>
      s.exports.categories(),
    );

    app.get('/settings/export', { schema: { response: { 200: ExportSettingsSchema } } }, () =>
      s.settings.getExport(),
    );

    app.put(
      '/settings/export',
      { schema: { body: ExportSettingsSchema, response: { 200: ExportSettingsSchema } } },
      (req) => {
        const known = new Set(s.exports.platforms().map((p) => p.id));
        const unknown = req.body.enabledPlatforms.filter((id) => !known.has(id));
        if (unknown.length) throw badRequest(`Unknown stock platforms: ${unknown.join(', ')}`);
        return s.settings.putExport(req.body);
      },
    );
  };
