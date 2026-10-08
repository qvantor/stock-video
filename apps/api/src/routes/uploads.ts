import type { FastifyPluginAsync } from 'fastify';
import type { Server } from '@tus/server';
import { UPLOAD_PATH } from '../services/uploads.js';

/** Hands every /api/uploads request to the tus server untouched (raw streams). */
export const uploadRoutes =
  (tus: Server): FastifyPluginAsync =>
  async (app) => {
    // Let tus consume the request body stream itself.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_req, _payload, done) => done(null));

    const handler = async (
      req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => {
      reply.hijack();
      await tus.handle(req.raw, reply.raw);
    };
    app.all(UPLOAD_PATH, handler);
    app.all(`${UPLOAD_PATH}/*`, handler);
  };
