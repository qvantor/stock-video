import send from '@fastify/send';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DataPaths } from '../lib/paths.js';

/** Only proxies and sprites are public; sources are never served. */
const MediaParams = z.object({
  videoId: z.uuid(),
  file: z.enum(['proxy.mp4', 'sprite.jpg']),
});

/** Proxy videos and sprite sheets with HTTP Range / conditional request support. */
export const mediaRoutes =
  (paths: DataPaths): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/media/:videoId/:file', { schema: { params: MediaParams } }, async (req, reply) => {
      const { videoId, file } = req.params;
      const result = await send(req.raw, `/${videoId}/${file}`, {
        root: paths.videosRoot,
        acceptRanges: true,
        etag: true,
        lastModified: true,
        cacheControl: false,
      });
      if (result.type === 'error') {
        return reply.code(result.statusCode).send({ error: 'File not found' });
      }
      return reply
        .code(result.statusCode)
        .headers({ ...result.headers, 'cache-control': 'no-cache' })
        .send(result.stream);
    });
  };
