import { analyzeTech } from '@dfs/tech-analysis';
import { hashOf } from '../hash.js';
import type { PipelineStep, StepContext } from '../types.js';

const inputs = ({ clip, video, settings }: StepContext) => {
  const m = video.media;
  return {
    media: {
      fps: m.fps,
      width: m.width,
      height: m.height,
      codec: m.codec,
      bitDepth: m.bitDepth,
      colorTransfer: m.colorTransfer,
      hasAudio: m.hasAudio,
      creationTime: m.creationTime,
      make: m.make,
      model: m.model,
      tags: m.tags,
    },
    originalFilename: video.originalFilename,
    startSec: clip.startSec,
    endSec: clip.endSec,
    motionType: clip.motionType,
    lat: clip.geo?.lat ?? m.location?.lat ?? null,
    lon: clip.geo?.lon ?? m.location?.lon ?? null,
    altitudeM: clip.geo?.altitudeM ?? m.location?.altitudeM ?? null,
    slowMoConform: settings.slowMoConform,
    creationTimeMode: settings.creationTimeMode,
  };
};

/** Deterministic technical features (no LLM): fps, resolution, shot type, light, season. */
export const techStep = (): PipelineStep => ({
  name: 'tech',
  hash: (ctx) => hashOf('tech.v1', inputs(ctx)),
  isComplete: (clip) => clip.tech !== null,
  run: async (ctx) => ({ tech: analyzeTech(inputs(ctx)) }),
});
