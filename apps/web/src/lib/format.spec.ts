import { formatBytes, formatDuration } from './format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [2048 * 1024 ** 4, '2048 TB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [9.4, '0:09'],
    [59.6, '1:00'],
    [125, '2:05'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %d as %s', (sec, expected) => {
    expect(formatDuration(sec)).toBe(expected);
  });
});
