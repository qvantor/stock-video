// @vitest-environment node

import { createHash } from 'node:crypto';
import { FINGERPRINT_CHUNK } from '@dfs/contracts';
import { fileFingerprint } from './fingerprint';

describe('fileFingerprint (browser)', () => {
  it('matches the layout the API hashes: size, first and last chunk', async () => {
    const data = new Uint8Array(FINGERPRINT_CHUNK * 2 + 777);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
    const expected = createHash('sha256')
      .update(`${data.length}\n`)
      .update(data.subarray(0, FINGERPRINT_CHUNK))
      .update(data.subarray(data.length - FINGERPRINT_CHUNK))
      .digest('hex');
    expect(await fileFingerprint(new Blob([data]))).toBe(expected);
  });
});
