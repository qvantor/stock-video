import { create } from 'zustand';
import pLimit from 'p-limit';
import * as tus from 'tus-js-client';
import type { DuplicateCheckFile, ExistingVideoInfo } from '@dfs/contracts';
import { checkDuplicates } from '../api/videos';
import { fileFingerprint, readDuration } from './fingerprint';

/** Parallel uploads limit. */
const limit = pLimit(3);
/** Parallel fingerprint computations (each reads up to 16 MB of the file). */
const hashLimit = pLimit(2);
const CHUNK_SIZE = 64 * 1024 * 1024;

export interface LocalUpload {
  key: string;
  projectId: string;
  filename: string;
  size: number;
  /** 0..1 */
  progress: number;
  /** `checking`: looking for the same video on the server; `duplicate`: found, waiting for the user. */
  state: 'checking' | 'duplicate' | 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
  fingerprint?: string;
  durationSec?: number;
  /** Stored videos this file duplicates (state `duplicate`). */
  duplicates?: ExistingVideoInfo[];
}

interface UploadState {
  uploads: Record<string, LocalUpload>;
  addFiles: (projectId: string, files: File[]) => void;
  retry: (key: string) => void;
  /** Upload a file flagged as a duplicate anyway. */
  uploadAnyway: (key: string) => void;
  dismiss: (key: string) => void;
  /** Abort and forget all uploads of a project (it is being deleted). */
  cancelProject: (projectId: string) => void;
}

const files = new Map<string, File>();
const active = new Map<string, tus.Upload>();

export const useUploadStore = create<UploadState>((set, get) => {
  const patch = (key: string, p: Partial<LocalUpload>) =>
    set((s) => {
      const cur = s.uploads[key];
      return cur ? { uploads: { ...s.uploads, [key]: { ...cur, ...p } } } : s;
    });

  const start = (key: string) => {
    const file = files.get(key);
    const entry = get().uploads[key];
    if (!file || !entry) return;
    patch(key, { state: 'waiting', error: undefined, duplicates: undefined });
    void limit(
      () =>
        new Promise<void>((resolve) => {
          patch(key, { state: 'uploading' });
          const upload = new tus.Upload(file, {
            endpoint: '/api/uploads',
            chunkSize: CHUNK_SIZE,
            retryDelays: [0, 1000, 3000, 5000, 10000],
            removeFingerprintOnSuccess: true,
            metadata: {
              projectId: entry.projectId,
              filename: file.name,
              filetype: file.type,
              ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
            },
            onProgress: (sent, total) => patch(key, { progress: total ? sent / total : 0 }),
            onSuccess: () => {
              patch(key, { state: 'done', progress: 1 });
              files.delete(key);
              active.delete(key);
              resolve();
            },
            onError: (err) => {
              const body = 'originalResponse' in err ? err.originalResponse?.getBody() : undefined;
              active.delete(key);
              patch(key, { state: 'error', error: body || err.message });
              resolve();
            },
          });
          active.set(key, upload);
          // Resume an interrupted upload of the same file if tus remembers it.
          void upload.findPreviousUploads().then((prev) => {
            const last = prev[0];
            if (last) upload.resumeFromPreviousUpload(last);
            upload.start();
          });
        }),
    );
  };

  /** Fingerprint new files, ask the server for duplicates, start the rest. */
  const checkAndStart = async (keys: string[]) => {
    const checks: DuplicateCheckFile[] = [];
    await Promise.all(
      keys.map((key) =>
        hashLimit(async () => {
          const file = files.get(key);
          if (!file) return;
          try {
            const [fingerprint, durationSec] = await Promise.all([
              fileFingerprint(file),
              readDuration(file),
            ]);
            patch(key, { fingerprint, durationSec });
            checks.push({
              key,
              filename: file.name,
              sizeBytes: file.size,
              fingerprint,
              durationSec,
            });
          } catch {
            // Cannot read the file here: upload it, the server still detects duplicates.
          }
        }),
      ),
    );
    let matches: Record<string, ExistingVideoInfo[]> = {};
    if (checks.length > 0) {
      try {
        matches = (await checkDuplicates({ files: checks })).matches;
      } catch {
        // The check is best effort; processing flags duplicates after upload.
      }
    }
    for (const key of keys) {
      if (get().uploads[key]?.state !== 'checking') continue; // dismissed meanwhile
      const found = matches[key];
      if (found?.length) patch(key, { state: 'duplicate', duplicates: found });
      else start(key);
    }
  };

  return {
    uploads: {},
    addFiles: (projectId, newFiles) => {
      const added: Record<string, LocalUpload> = {};
      for (const file of newFiles) {
        const key = `${projectId}:${file.name}:${file.size}:${file.lastModified}`;
        const existing = get().uploads[key];
        if (existing && existing.state !== 'error') continue;
        files.set(key, file);
        added[key] = {
          key,
          projectId,
          filename: file.name,
          size: file.size,
          progress: 0,
          state: 'checking',
        };
      }
      set((s) => ({ uploads: { ...s.uploads, ...added } }));
      const keys = Object.keys(added);
      if (keys.length > 0) void checkAndStart(keys);
    },
    retry: (key) => start(key),
    uploadAnyway: (key) => start(key),
    cancelProject: (projectId) =>
      set((s) => {
        const next = { ...s.uploads };
        for (const [key, u] of Object.entries(s.uploads)) {
          if (u.projectId !== projectId) continue;
          void active.get(key)?.abort(false);
          active.delete(key);
          files.delete(key);
          delete next[key];
        }
        return { uploads: next };
      }),
    dismiss: (key) =>
      set((s) => {
        const next = { ...s.uploads };
        delete next[key];
        files.delete(key);
        return { uploads: next };
      }),
  };
});
