import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { fingerprintPrefix, fingerprintRanges } from '@dfs/contracts';

/** Quick fingerprint of a file (same byte layout as the browser computes before upload). */
export const fileFingerprint = async (file: string): Promise<string> => {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const hash = createHash('sha256').update(fingerprintPrefix(size));
    for (const [start, end] of fingerprintRanges(size)) {
      const buf = Buffer.alloc(end - start);
      let read = 0;
      while (read < buf.length) {
        const { bytesRead } = await handle.read(buf, read, buf.length - read, start + read);
        if (bytesRead === 0) throw new Error(`Unexpected end of file: ${file}`);
        read += bytesRead;
      }
      hash.update(buf);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
};

/** sha256 of the whole file, streamed. */
export const fileSha256 = async (
  file: string,
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const { size } = await fs.stat(file);
  const hash = createHash('sha256');
  let done = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 4 * 1024 * 1024, signal })) {
    hash.update(chunk as Buffer);
    done += (chunk as Buffer).length;
    if (size) onProgress?.(done / size);
  }
  return hash.digest('hex');
};
