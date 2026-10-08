import { FINGERPRINT_CHUNK, fingerprintRanges } from './dedup.js';

describe('fingerprintRanges', () => {
  it('hashes the whole file when it fits into one chunk', () => {
    expect(fingerprintRanges(0)).toEqual([[0, 0]]);
    expect(fingerprintRanges(100)).toEqual([[0, 100]]);
    expect(fingerprintRanges(FINGERPRINT_CHUNK)).toEqual([[0, FINGERPRINT_CHUNK]]);
  });

  it('does not overlap head and tail of a small file', () => {
    const size = FINGERPRINT_CHUNK + 10;
    expect(fingerprintRanges(size)).toEqual([
      [0, FINGERPRINT_CHUNK],
      [FINGERPRINT_CHUNK, size],
    ]);
  });

  it('takes the first and the last chunk of a large file', () => {
    const size = FINGERPRINT_CHUNK * 5;
    expect(fingerprintRanges(size)).toEqual([
      [0, FINGERPRINT_CHUNK],
      [size - FINGERPRINT_CHUNK, size],
    ]);
  });
});
