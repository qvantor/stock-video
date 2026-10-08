import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/client.js';
import { buildApp } from '../app.js';
import { InProcessAnalyzer } from '@dfs/video-analysis';
import type { ServiceOverrides, Services } from '../services/container.js';

export interface TestHarness {
  app: FastifyInstance;
  services: Services;
  dataDir: string;
  close: () => Promise<void>;
}

/** Fresh app with an in-memory DB and a temp DATA_DIR. */
export const createHarness = async (overrides: ServiceOverrides = {}): Promise<TestHarness> => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-api-'));
  const config = {
    ...loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'error' }),
    dbPath: ':memory:',
  };
  const { db, close } = openDatabase(
    config.dbPath,
    path.resolve(import.meta.dirname, '../../drizzle'),
  );
  // tus FileStore creates its directory with a fire-and-forget fs.mkdir that throws from the
  // callback on failure. Track those calls so close() can wait for them before removing the dir.
  const pendingMkdirs: Promise<void>[] = [];
  const realMkdir = fs.mkdir;
  const mkdirSpy = vi.spyOn(fs, 'mkdir').mockImplementation(((
    dir: fs.PathLike,
    options: fs.MakeDirectoryOptions,
    cb: (err: NodeJS.ErrnoException | null, made?: string) => void,
  ) => {
    pendingMkdirs.push(
      new Promise((resolve) =>
        realMkdir(dir, options, (err, made) => {
          resolve();
          cb(err, made);
        }),
      ),
    );
  }) as unknown as typeof fs.mkdir);
  let built: Awaited<ReturnType<typeof buildApp>>;
  try {
    built = await buildApp(config, db, { analyzer: new InProcessAnalyzer(), ...overrides });
  } finally {
    mkdirSpy.mockRestore();
  }
  const { app, services } = built;
  return {
    app,
    services,
    dataDir,
    close: async () => {
      // Stop background work (processing queue, export pipeline) so it never hits the closed DB.
      for (const project of services.projects.list()) {
        for (const video of services.videos.listByProject(project.id)) {
          await services.queue.cancel(video.id);
        }
        await services.exports.cancelProject(project.id);
      }
      await services.queue.onIdle();
      await services.exports.pipeline.onIdle();
      await app.close();
      close();
      await Promise.all(pendingMkdirs);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
};
