import type { Segment } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

const seg = (
  videoId: string,
  id: string,
  startSec: number,
  endSec: number,
  extra: Partial<Segment> = {},
): Segment => ({
  id,
  videoId,
  startSec,
  endSec,
  motionType: 'orbit_left',
  score: 0.9,
  reasons: [],
  origin: 'ai',
  accepted: true,
  edited: false,
  ...extra,
});

describe('SegmentService', () => {
  let h: TestHarness;
  let projectId: string;
  let videoId: string;

  beforeEach(async () => {
    h = await createHarness();
    projectId = h.services.projects.create('Segments').id;
    videoId = h.services.videos.createUploading({
      projectId,
      uploadId: 'u1',
      originalFilename: 'A.MP4',
      sizeBytes: 10,
    }).id;
    h.services.videos.update(videoId, { status: 'ready', durationSec: 60, fps: 30 });
  });
  afterEach(async () => {
    await h.close();
  });

  describe('replaceAiSegments', () => {
    it('keeps user and edited segments and drops overlapping AI proposals', () => {
      h.services.segments.replace(videoId, [
        seg(videoId, 'old-ai', 0, 10),
        seg(videoId, 'user', 12, 20, { origin: 'user' }),
        seg(videoId, 'edited', 30, 40, { edited: true }),
      ]);

      const result = h.services.segments.replaceAiSegments(videoId, [
        seg(videoId, 'new-a', 0, 11),
        seg(videoId, 'new-overlaps-user', 18, 25),
        seg(videoId, 'new-overlaps-edited', 35, 45),
        seg(videoId, 'new-b', 45, 55),
      ]);

      expect(result.map((s) => s.id)).toEqual(['new-a', 'user', 'edited', 'new-b']);
    });

    it('treats touching segments as non-overlapping', () => {
      h.services.segments.replace(videoId, [seg(videoId, 'user', 10, 20, { origin: 'user' })]);

      const result = h.services.segments.replaceAiSegments(videoId, [
        seg(videoId, 'before', 0, 10),
        seg(videoId, 'after', 20, 30),
      ]);

      expect(result.map((s) => s.id)).toEqual(['before', 'user', 'after']);
    });

    it('publishes segments.updated', () => {
      const events: string[] = [];
      h.services.bus.subscribe(projectId, (e) => events.push(e.type));

      h.services.segments.replaceAiSegments(videoId, [seg(videoId, 'a', 0, 10)]);

      expect(events).toContain('segments.updated');
    });
  });

  describe('replace', () => {
    it('rejects a segment that extends beyond the video duration', () => {
      expect(() => h.services.segments.replace(videoId, [seg(videoId, 'a', 50, 60.1)])).toThrow(
        /beyond the video duration/,
      );
    });

    it('allows a small tolerance past the end of the video', () => {
      const result = h.services.segments.replace(videoId, [seg(videoId, 'a', 50, 60.04)]);
      expect(result).toHaveLength(1);
    });

    it('returns the segments sorted by start time', () => {
      const result = h.services.segments.replace(videoId, [
        seg(videoId, 'b', 20, 30),
        seg(videoId, 'a', 0, 10),
      ]);
      expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    });
  });

  describe('summary', () => {
    it('reports blockers for an empty project', () => {
      const empty = h.services.projects.create('Empty').id;
      const summary = h.services.segments.summary(empty);
      expect(summary.canConfirm).toBe(false);
      expect(summary.blockers).toEqual(['No videos', 'No accepted segments']);
    });

    it('counts only ready videos and blocks while others are processing', () => {
      h.services.segments.replace(videoId, [
        seg(videoId, 'a', 0, 10),
        seg(videoId, 'b', 20, 35, { accepted: false }),
      ]);
      const processing = h.services.videos.createUploading({
        projectId,
        uploadId: 'u2',
        originalFilename: 'B.MP4',
        sizeBytes: 10,
      }).id;
      h.services.videos.update(processing, { status: 'analyzing' });

      const summary = h.services.segments.summary(projectId);

      expect(summary).toMatchObject({
        videoCount: 2,
        readyCount: 1,
        failedCount: 0,
        processingCount: 1,
        proposedSegments: 2,
        acceptedSegments: 1,
        acceptedDurationSec: 10,
        issueCount: 0,
        canConfirm: false,
      });
      expect(summary.blockers).toEqual(['Not all videos are processed']);
    });

    it('allows confirming once every video is settled and segments are valid', () => {
      h.services.segments.replace(videoId, [seg(videoId, 'a', 0, 10)]);
      const failed = h.services.videos.createUploading({
        projectId,
        uploadId: 'u2',
        originalFilename: 'B.MP4',
        sizeBytes: 10,
      }).id;
      h.services.videos.update(failed, { status: 'failed', error: 'boom' });

      const summary = h.services.segments.summary(projectId);

      expect(summary.failedCount).toBe(1);
      expect(summary.blockers).toEqual([]);
      expect(summary.canConfirm).toBe(true);
    });

    it('blocks on invalid segments, counting each segment once', () => {
      // Shorter than the project's minimum duration (7 s by default).
      h.services.segments.replace(videoId, [seg(videoId, 'a', 0, 2), seg(videoId, 'b', 10, 30)]);

      const summary = h.services.segments.summary(projectId);

      expect(summary.issueCount).toBe(1);
      expect(summary.blockers).toEqual(['Invalid segments: 1']);
    });

    it('blocks when no segment is accepted', () => {
      h.services.segments.replace(videoId, [seg(videoId, 'a', 0, 10, { accepted: false })]);
      expect(h.services.segments.summary(projectId).blockers).toEqual(['No accepted segments']);
    });
  });
});
