import { and, asc, eq } from 'drizzle-orm';
import {
  isVideoSettled,
  validateSegments,
  type ProjectSummary,
  type Segment,
} from '@dfs/contracts';
import type { Db } from '../db/client.js';
import { segments } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import type { EventBus } from './event-bus.js';
import { toSegment } from './mappers.js';
import type { ProjectService } from './projects.js';
import type { VideoService } from './videos.js';

export class SegmentService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly projects: ProjectService,
    private readonly videos: VideoService,
  ) {}

  list(videoId: string): Segment[] {
    return this.db
      .select()
      .from(segments)
      .where(eq(segments.videoId, videoId))
      .orderBy(asc(segments.startSec))
      .all()
      .map(toSegment);
  }

  /** Replace the whole segment set of a video (editor autosave). */
  replace(videoId: string, next: Segment[]): Segment[] {
    const video = this.videos.getRow(videoId);
    this.projects.assertEditable(video.projectId);
    const ids = new Set<string>();
    for (const s of next) {
      if (s.videoId !== videoId) throw badRequest(`Segment ${s.id} belongs to another video`);
      if (ids.has(s.id)) throw badRequest(`Duplicate segment id ${s.id}`);
      ids.add(s.id);
      if (video.durationSec !== null && s.endSec > video.durationSec + 0.05) {
        throw badRequest(`Segment ${s.id} extends beyond the video duration`);
      }
    }
    this.db.transaction((tx) => {
      tx.delete(segments).where(eq(segments.videoId, videoId)).run();
      if (next.length > 0) tx.insert(segments).values(next).run();
    });
    this.bus.publish(video.projectId, { type: 'segments.updated', videoId });
    return this.list(videoId);
  }

  /**
   * Replace AI proposals after (re)analysis. User-created and user-edited
   * segments are kept; new AI segments overlapping them are dropped.
   */
  replaceAiSegments(videoId: string, proposals: Segment[]): Segment[] {
    const video = this.videos.getRow(videoId);
    const kept = this.list(videoId).filter((s) => s.origin === 'user' || s.edited);
    const overlaps = (a: Segment, b: Segment) => a.startSec < b.endSec && b.startSec < a.endSec;
    const fresh = proposals.filter((p) => !kept.some((k) => overlaps(k, p)));
    this.db.transaction((tx) => {
      tx.delete(segments)
        .where(
          and(eq(segments.videoId, videoId), eq(segments.origin, 'ai'), eq(segments.edited, false)),
        )
        .run();
      if (fresh.length > 0) tx.insert(segments).values(fresh).run();
    });
    this.bus.publish(video.projectId, { type: 'segments.updated', videoId });
    return this.list(videoId);
  }

  summary(projectId: string): ProjectSummary {
    const project = this.projects.get(projectId);
    const videos = this.videos.listByProject(projectId);
    let proposed = 0;
    let accepted = 0;
    let acceptedDuration = 0;
    let issues = 0;
    for (const v of videos) {
      if (v.status !== 'ready') continue;
      const list = this.list(v.id);
      proposed += list.length;
      for (const s of list) {
        if (!s.accepted) continue;
        accepted++;
        acceptedDuration += s.endSec - s.startSec;
      }
      issues += new Set(
        validateSegments(list, project.analysisSettings, v.durationSec).map((i) => i.segmentId),
      ).size;
    }
    const readyCount = videos.filter((v) => v.status === 'ready').length;
    const failedCount = videos.filter((v) => v.status === 'failed').length;
    const processingCount = videos.length - readyCount - failedCount;

    const blockers: string[] = [];
    if (project.status === 'confirmed') blockers.push('The project is already confirmed');
    if (videos.length === 0) blockers.push('No videos');
    if (!videos.every((v) => isVideoSettled(v.status)))
      blockers.push('Not all videos are processed');
    if (accepted === 0) blockers.push('No accepted segments');
    if (issues > 0) blockers.push(`Invalid segments: ${issues}`);

    return {
      videoCount: videos.length,
      readyCount,
      failedCount,
      processingCount,
      proposedSegments: proposed,
      acceptedSegments: accepted,
      acceptedDurationSec: acceptedDuration,
      issueCount: issues,
      canConfirm: blockers.length === 0,
      blockers,
    };
  }
}
