import { createRequire } from 'node:module';

export type CV = typeof import('@techstark/opencv-js');

interface EmscriptenModule {
  Mat?: unknown;
  onRuntimeInitialized?: () => void;
  then?: (cb: (m: EmscriptenModule) => void) => unknown;
}

let cached: Promise<CV> | null = null;

/** Load the opencv-js WASM runtime once per thread. */
export const loadOpenCv = (): Promise<CV> => {
  cached ??= new Promise<CV>((resolve) => {
    const require = createRequire(import.meta.url);
    const mod = require('@techstark/opencv-js') as EmscriptenModule;
    const done = (m: EmscriptenModule) => resolve(m as unknown as CV);
    if (mod.Mat) return done(mod);
    if (typeof mod.then === 'function') {
      // Emscripten modules are thenables resolving to themselves; drop `then` to avoid recursion.
      mod.then((m) => {
        delete m.then;
        done(m);
      });
      return;
    }
    mod.onRuntimeInitialized = () => done(mod);
  });
  return cached;
};
