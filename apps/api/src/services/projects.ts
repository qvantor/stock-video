import { randomUUID } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_ANALYSIS_SETTINGS,
  PROJECT_PREVIEW_LIMIT,
  type AnalysisSettings,
  type Project,
  type ProjectListItem,
  type ProjectOverview,
} from '@dfs/contracts';
import type { Db } from '../db/client.js';
import { projects, segments, videos, type ProjectRow } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { mediaUrl, type DataPaths } from '../lib/paths.js';
import type { EventBus } from './event-bus.js';
import { toProject } from './mappers.js';

export class ProjectService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly paths: DataPaths,
  ) {}

  /** Row → DTO, with manifestPath shown as the user sees it on the host. */
  private dto(row: ProjectRow): Project {
    const p = toProject(row);
    return p.manifestPath ? { ...p, manifestPath: this.paths.toHost(p.manifestPath) } : p;
  }

  /** All projects, newest first, each with an overview of its videos and segments. */
  list(): ProjectListItem[] {
    const overviews = new Map<string, ProjectOverview>();
    const overviewOf = (projectId: string): ProjectOverview => {
      let o = overviews.get(projectId);
      if (!o) {
        o = {
          videoCount: 0,
          statusCounts: {},
          reviewedCount: 0,
          segmentCount: 0,
          acceptedSegments: 0,
          previews: [],
        };
        overviews.set(projectId, o);
      }
      return o;
    };

    const videoRows = this.db
      .select({
        id: videos.id,
        projectId: videos.projectId,
        status: videos.status,
        spriteMeta: videos.spriteMeta,
        reviewed: videos.reviewed,
      })
      .from(videos)
      .orderBy(asc(videos.createdAt))
      .all();
    for (const v of videoRows) {
      const o = overviewOf(v.projectId);
      o.videoCount++;
      o.statusCounts[v.status] = (o.statusCounts[v.status] ?? 0) + 1;
      if (v.reviewed) o.reviewedCount++;
      if (v.spriteMeta && o.previews.length < PROJECT_PREVIEW_LIMIT) {
        o.previews.push({
          videoId: v.id,
          spriteUrl: mediaUrl(v.id, 'sprite.jpg'),
          spriteMeta: v.spriteMeta,
        });
      }
    }

    const segmentRows = this.db
      .select({
        projectId: videos.projectId,
        total: sql<number>`count(*)`,
        accepted: sql<number>`coalesce(sum(${segments.accepted}), 0)`,
      })
      .from(segments)
      .innerJoin(videos, eq(segments.videoId, videos.id))
      .groupBy(videos.projectId)
      .all();
    for (const r of segmentRows) {
      const o = overviewOf(r.projectId);
      o.segmentCount = Number(r.total);
      o.acceptedSegments = Number(r.accepted);
    }

    return this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .all()
      .map((r) => ({ ...this.dto(r), overview: overviewOf(r.id) }));
  }

  create(name: string): Project {
    const row = this.db
      .insert(projects)
      .values({
        id: randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        status: 'draft',
        analysisSettings: DEFAULT_ANALYSIS_SETTINGS,
      })
      .returning()
      .get();
    return this.dto(row);
  }

  get(id: string): Project {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw notFound('Project');
    return this.dto(row);
  }

  /** Throws 409 if the project is confirmed (read-only). */
  assertEditable(id: string): Project {
    const project = this.get(id);
    if (project.status === 'confirmed') throw conflict('The project is confirmed and read-only');
    return project;
  }

  updateSettings(id: string, settings: AnalysisSettings): Project {
    this.assertEditable(id);
    const row = this.db
      .update(projects)
      .set({ analysisSettings: settings })
      .where(eq(projects.id, id))
      .returning()
      .get();
    const project = this.dto(row);
    this.bus.publish(id, { type: 'project.updated', project });
    return project;
  }

  /** Back to an editable draft (the manifest is gone). */
  markDraft(id: string): Project {
    const row = this.db
      .update(projects)
      .set({ status: 'draft', manifestPath: null })
      .where(eq(projects.id, id))
      .returning()
      .get();
    const project = this.dto(row);
    this.bus.publish(id, { type: 'project.updated', project });
    return project;
  }

  markConfirmed(id: string, manifestPath: string): Project {
    const row = this.db
      .update(projects)
      .set({ status: 'confirmed', manifestPath })
      .where(eq(projects.id, id))
      .returning()
      .get();
    const project = this.dto(row);
    this.bus.publish(id, { type: 'project.updated', project });
    return project;
  }
}
