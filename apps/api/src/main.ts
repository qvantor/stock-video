import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFlowWorkerThread, runFlowWorker } from '@dfs/video-analysis';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/client.js';
import { checkBinaries, MissingBinaryError } from '@dfs/ffmpeg';
import { buildApp } from './app.js';

const entry = fileURLToPath(import.meta.url);
const here = path.dirname(entry);

const main = async (): Promise<void> => {
  const config = loadConfig();

  try {
    const versions = await checkBinaries(config);
    console.log(versions.join('\n'));
  } catch (err) {
    if (err instanceof MissingBinaryError) {
      console.error(`\n[api] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const { db, close } = openDatabase(config.dbPath, path.join(here, 'drizzle'));
  // The bundle doubles as the motion-analysis worker entry (see bottom of file).
  const { app, services } = await buildApp(config, db, { workerEntry: entry, assetsRoot: here });

  const shutdown = async (): Promise<void> => {
    await app.close();
    close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ dataDir: config.dataDir, dbPath: config.dbPath }, 'API ready');
  services.queue.resumeInterrupted();
  services.queue.backfillHashes();
  services.exports.resumeAll();
};

if (isFlowWorkerThread()) {
  runFlowWorker();
} else {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
