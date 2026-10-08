import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ProjectEvent } from '@dfs/contracts';
import type { Services } from '../services/container.js';

const HEARTBEAT_MS = 15_000;

/** Server-Sent Events stream of processing progress and changes within a project. */
export const eventRoutes =
  (s: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/projects/:id/events',
      { schema: { params: z.object({ id: z.string() }) } },
      (req, reply) => {
        const projectId = req.params.id;
        s.projects.get(projectId);
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 3000\n\n');

        const send = (event: ProjectEvent) =>
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        const unsubscribe = s.bus.subscribe(projectId, send);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

        req.raw.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
      },
    );
  };
