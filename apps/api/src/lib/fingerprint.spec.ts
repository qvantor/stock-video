import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FINGERPRINT_CHUNK } from '@dfs/contracts';
import { fileFingerprint, fileSha256 } from './fingerprint.js';

const sha256 = (...parts: Array<string | Buffer>) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

describe('file fingerprint', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-fp-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (data: Buffer) => {
    const file = path.join(dir, 'f.bin');
    fs.writeFileSync(file, data);
    return file;
  };

  it('hashes size, head and tail of a large file', async () => {
    const data = randomBytes(FINGERPRINT_CHUNK * 2 + 12345);
    const file = write(data);
    const expected = sha256(
      `${data.length}\n`,
      data.subarray(0, FINGERPRINT_CHUNK),
      data.subarray(data.length - FINGERPRINT_CHUNK),
    );
    expect(await fileFingerprint(file)).toBe(expected);
  });

  it('hashes a small file whole', async () => {
    const data = randomBytes(1000);
    expect(await fileFingerprint(write(data))).toBe(sha256('1000\n', data));
  });

  it('computes the full sha256 and reports progress', async () => {
    const data = randomBytes(9 * 1024 * 1024);
    const progress: number[] = [];
    expect(await fileSha256(write(data), (f) => progress.push(f))).toBe(sha256(data));
    expect(progress.at(-1)).toBe(1);
  });
});
