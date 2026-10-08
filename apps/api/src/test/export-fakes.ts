import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClipStep } from '@dfs/contracts';
import type { PipelineStep, PipelineSteps } from '@dfs/export-pipeline';

/** Deterministic in-memory steps so route tests do not need ffmpeg, Nominatim or Ollama. */
export const fakeExportSteps = (runs: Record<ClipStep, number>): PipelineSteps => {
  const step = (name: ClipStep, patch: Awaited<ReturnType<PipelineStep['run']>>): PipelineStep => ({
    name,
    hash: (ctx) => `${name}:${ctx.video.manualLocation ?? ''}`,
    isComplete: () => true,
    run: async () => {
      runs[name]++;
      return patch;
    },
  });
  return {
    frames: step('frames', { frames: [] }),
    geo: step('geo', {}),
    tech: step('tech', {
      tech: {
        durationSec: 20,
        sourceDurationSec: 20,
        fps: 30,
        outputFps: 30,
        width: 3840,
        height: 2160,
        resolutionLabel: '4K',
        codec: 'hevc',
        bitDepth: 10,
        colorTransfer: 'rec709',
        hasAudio: false,
        shotType: 'real_time',
        motionType: 'orbit_left',
        movement: ['Aerial', 'Drone', 'Arc'],
        timeOfDay: null,
        season: null,
        capturedAt: null,
        captureDate: '2024-07-14',
        altitudeM: null,
        droneModel: null,
      },
    }),
    llm: step('llm', {
      metadata: {
        title: 'Aerial Orbit Around Wooden Church, Lake Onega, Russia',
        description: 'Drone orbits a wooden church on an island at golden hour in summer.',
        keywords: ['wooden church', 'kizhi', 'russia', 'aerial', 'drone'],
        subject: 'wooden church',
        placeConfidence: 'medium',
        adobeCategory: 2,
        shutterstockCategories: ['Buildings/Landmarks'],
        envatoCategory: 'Buildings',
        recognizableBuildings: true,
        editorialSuggested: false,
        editorialReason: null,
      },
    }),
    cut: {
      ...step('cut', {}),
      run: async (ctx) => {
        runs.cut++;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-fake-cut-'));
        const cutPath = path.join(dir, `${ctx.clip.id}.mov`);
        fs.writeFileSync(cutPath, Buffer.alloc(4096, 7));
        return { cutPath, outputSizeBytes: 4096 };
      },
    },
  };
};
