import type { PipelineSteps } from '../types.js';
import type { StepDeps } from './deps.js';
import { framesStep } from './frames.js';
import { geoStep } from './geo.js';
import { techStep } from './tech.js';
import { llmStep } from './llm.js';
import { cutStep } from './cut.js';

export type { StepDeps } from './deps.js';
export { framesStep, pickFrameTimes, needsNormalization, frameFile } from './frames.js';
export { geoStep } from './geo.js';
export { techStep } from './tech.js';
export { llmStep } from './llm.js';
export { cutStep, cutArgs, type CutPlan } from './cut.js';

export const createExportSteps = (deps: StepDeps): PipelineSteps => ({
  frames: framesStep(deps),
  geo: geoStep(deps),
  tech: techStep(),
  llm: llmStep(deps),
  cut: cutStep(deps),
});
