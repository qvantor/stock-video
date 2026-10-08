import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExportClip, Project, Segment, SourceVideo } from '@dfs/contracts';

export const makeQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Renders the current location so tests can assert navigation. */
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

/**
 * Renders `ui` inside a fresh QueryClient and a MemoryRouter.
 * `path` is the route pattern (for params), `route` the initial URL.
 */
export const renderWithProviders = (
  ui: ReactElement,
  {
    route = '/',
    path = '*',
    queryClient = makeQueryClient(),
  }: { route?: string; path?: string; queryClient?: QueryClient } = {},
): RenderResult & { queryClient: QueryClient } => {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
};

/** Current pathname rendered by `renderWithProviders`. */
export const currentPath = (container: ParentNode = document): string | null =>
  container.querySelector('[data-testid="location"]')?.textContent ?? null;

export type FetchCall = { method: string; url: string; body: unknown };
type RouteHandler = (body: unknown, call: FetchCall) => unknown;
type RouteValue = RouteHandler | Response | object | string | number | boolean | null | undefined;

/**
 * Stubs global `fetch`. Keys are `"METHOD /api/path"` or `"/api/path"` (any method).
 * Values are JSON bodies, `Response`s, or functions returning either.
 * Unknown routes answer 404. Returns the list of recorded calls.
 */
export const stubFetch = (routes: Record<string, RouteValue>) => {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { method, url, body };
    calls.push(call);
    const key = `${method} ${url}` in routes ? `${method} ${url}` : url;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    const value = routes[key];
    const result = typeof value === 'function' ? await value(body, call) : value;
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

/** Controllable EventSource replacement; use `FakeEventSource.last().emit(type, data)`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error('No EventSource was created');
    return es;
  }
  static install(): void {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  }

  readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }
}

/** jsdom lacks HTMLDialogElement.showModal/close. */
export const polyfillDialog = (): void => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
};

export const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Kizhi',
  createdAt: '2024-07-15T10:00:00.000Z',
  status: 'draft',
  analysisSettings: {
    minDuration: 7,
    maxDuration: 40,
    targetDuration: 25,
    analysisFps: 5,
    sensitivity: 1.5,
    includeStatic: false,
  },
  manifestPath: null,
  ...over,
});

export const makeVideo = (over: Partial<SourceVideo> = {}): SourceVideo => ({
  id: 'v1',
  projectId: 'p1',
  originalFilename: 'DJI_0001.MP4',
  storedPath: '/data/projects/p1/videos/v1/source.mp4',
  sizeBytes: 1_000_000,
  durationSec: 60,
  fps: 29.97,
  width: 3840,
  height: 2160,
  codec: 'hevc',
  proxyUrl: '/media/v1/proxy.mp4',
  spriteUrl: null,
  spriteMeta: null,
  status: 'ready',
  progress: 1,
  error: null,
  createdAt: '2024-07-15T10:00:00.000Z',
  reviewed: false,
  duplicateOf: null,
  ...over,
});

export const makeSegment = (over: Partial<Segment> = {}): Segment => ({
  id: 's1',
  videoId: 'v1',
  startSec: 0,
  endSec: 10,
  motionType: 'forward',
  score: 0.8,
  reasons: [],
  origin: 'ai',
  accepted: true,
  edited: false,
  ...over,
});

export const makeClip = (over: Partial<ExportClip> = {}): ExportClip => ({
  id: 'c1',
  jobId: 'j1',
  videoId: 'v1',
  segmentId: 's1',
  ordinal: 0,
  originalFilename: 'DJI_0042.MP4',
  startSec: 0,
  endSec: 20,
  motionType: 'orbit_left',
  status: 'review',
  progress: 0,
  failedStep: null,
  error: null,
  excluded: false,
  approved: false,
  context: { frames: null, geo: null, tech: null },
  metadata: {
    title: 'Aerial Orbit Around Wooden Church, Kizhi, Russia',
    description: 'Drone orbits a wooden church.',
    keywords: ['church', 'kizhi'],
    subject: 'wooden church',
    placeConfidence: 'high',
    adobeCategory: 2,
    shutterstockCategories: ['Buildings/Landmarks'],
    envatoCategory: 'Buildings',
    recognizableBuildings: true,
    editorialSuggested: false,
    editorialReason: null,
  },
  editorial: false,
  generation: null,
  userHint: null,
  poiOverride: null,
  filename: 'wooden_church_kizhi_orbit_001.mov',
  outputSizeBytes: null,
  validations: [],
  updatedAt: '2024-07-15T10:00:00.000Z',
  ...over,
});
