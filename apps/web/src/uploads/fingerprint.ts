import { fingerprintPrefix, fingerprintRanges } from '@dfs/contracts';

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** Quick fingerprint of a file; the API computes the same value from the stored file. */
export const fileFingerprint = async (file: Blob): Promise<string> => {
  const parts: BlobPart[] = [fingerprintPrefix(file.size)];
  for (const [start, end] of fingerprintRanges(file.size)) parts.push(file.slice(start, end));
  const bytes = await new Blob(parts).arrayBuffer();
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
};

const DURATION_TIMEOUT_MS = 5000;

/** Duration from the container metadata, or undefined if the browser cannot read it. */
export const readDuration = (file: Blob): Promise<number | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (value: number | undefined) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), DURATION_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined);
    video.onerror = () => finish(undefined);
    video.src = url;
  });
