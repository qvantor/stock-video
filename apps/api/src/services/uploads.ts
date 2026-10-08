import fs from 'node:fs/promises';
import path from 'node:path';
import { EVENTS, Server, type Upload } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type { FastifyBaseLogger } from 'fastify';
import type { DataPaths } from '../lib/paths.js';
import type { ProcessingQueue } from './processing.js';
import type { ProjectService } from './projects.js';
import type { VideoService } from './videos.js';

export const UPLOAD_PATH = '/api/uploads';
const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov'];

/** Error shape understood by @tus/server: aborts the request with this status/body. */
const reject = (status_code: number, body: string) => ({ status_code, body });

/**
 * tus resumable uploads. Metadata: `projectId`, `filename`, optional `fingerprint`.
 * Creating an upload registers a SourceVideo in `uploading`; finishing moves the
 * file into the video directory and queues processing.
 */
export const createTusServer = (deps: {
  paths: DataPaths;
  projects: ProjectService;
  videos: VideoService;
  queue: ProcessingQueue;
  log: FastifyBaseLogger;
}): Server => {
  const { paths, projects, videos, queue, log } = deps;

  const tus = new Server({
    path: UPLOAD_PATH,
    datastore: new FileStore({ directory: paths.uploads }),
    relativeLocation: true,
    respectForwardedHeaders: true,
    postReceiveInterval: 1000,
    onUploadCreate: async (_req, upload) => {
      const projectId = upload.metadata?.['projectId'];
      const filename = upload.metadata?.['filename'];
      if (!projectId || !filename)
        throw reject(400, 'metadata projectId and filename are required');
      if (!ALLOWED_VIDEO_EXTENSIONS.includes(path.extname(filename).toLowerCase())) {
        throw reject(
          415,
          `Only these formats are supported: ${ALLOWED_VIDEO_EXTENSIONS.join(', ')}`,
        );
      }
      try {
        projects.assertEditable(projectId);
      } catch (err) {
        throw reject(409, err instanceof Error ? err.message : 'Project is not available');
      }
      videos.createUploading({
        projectId,
        uploadId: upload.id,
        originalFilename: path.basename(filename),
        sizeBytes: upload.size ?? 0,
        fingerprint: upload.metadata?.['fingerprint'] || null,
      });
      return {};
    },
    onUploadFinish: async (_req, upload) => {
      await finalizeUpload(upload);
      return {};
    },
  });

  const finalizeUpload = async (upload: Upload): Promise<void> => {
    const row = videos.findByUploadId(upload.id);
    const tmp = path.join(paths.uploads, upload.id);
    if (!row) {
      log.warn({ uploadId: upload.id }, 'finished upload without video record, discarding it');
      await fs.rm(tmp, { force: true });
      await fs.rm(`${tmp}.json`, { force: true });
      return;
    }
    const dest = paths.source(row.id, row.originalFilename);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tmp, dest);
    await fs.rm(`${tmp}.json`, { force: true });
    videos.update(row.id, {
      storedPath: dest,
      uploadId: null,
      sizeBytes: upload.size ?? row.sizeBytes,
    });
    queue.enqueue(row.id);
  };

  tus.on(EVENTS.POST_RECEIVE, (_req: unknown, upload: Upload) => {
    const row = videos.findByUploadId(upload.id);
    if (row && upload.size)
      videos.setProgress(row.id, 'uploading', (upload.offset ?? 0) / upload.size);
  });

  tus.on(EVENTS.POST_TERMINATE, (_req: unknown, _res: unknown, id: string) => {
    const row = videos.findByUploadId(id);
    if (row) void videos.remove(row.id);
  });

  return tus;
};
