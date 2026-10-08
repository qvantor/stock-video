import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExportState } from '@dfs/contracts';
import { ExportPage } from './ExportPage';

const state: ExportState = {
  job: {
    id: 'j1',
    projectId: 'p1',
    createdAt: '2024-07-15T10:00:00.000Z',
    total: 1,
    excluded: 0,
    counts: {
      queued: 0,
      frames: 0,
      geo: 0,
      tech: 0,
      llm: 0,
      review: 1,
      cut: 0,
      done: 0,
      failed: 0,
    },
    progress: 0.8,
    canBuild: false,
    buildStatus: 'idle',
    buildError: null,
    archive: null,
  },
  clips: [
    {
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
      validations: [{ platform: 'adobe', level: 'warning', messages: ['Too few keywords'] }],
      updatedAt: '2024-07-15T10:00:00.000Z',
    },
  ],
  videos: [],
};

const responses: Record<string, unknown> = {
  '/api/projects/p1': {
    id: 'p1',
    name: 'Kizhi',
    createdAt: '2024-07-15T10:00:00.000Z',
    status: 'confirmed',
    analysisSettings: {
      minDuration: 7,
      maxDuration: 40,
      targetDuration: 25,
      analysisFps: 5,
      sensitivity: 1.5,
      includeStatic: false,
    },
    manifestPath: '/data/projects/p1/manifest.json',
  },
  '/api/projects/p1/export': state,
  '/api/projects/p1/videos': [],
  '/api/export/health': {
    ok: false,
    url: 'http://localhost:11434',
    model: 'gemma4:31b',
    message: 'Model "gemma4:31b" is not installed in Ollama. Run: ollama pull gemma4:31b',
  },
  '/api/stock-platforms': [
    { id: 'adobe', label: 'Adobe Stock', lastVerified: '2026-10-07', verified: false },
  ],
  '/api/stock-categories': { adobe: [], shutterstock: [], envato: [] },
};

describe('ExportPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener = () => undefined;
        close = () => undefined;
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) => new Response(JSON.stringify(responses[url] ?? {}), { status: 200 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows clips, validation badges and the Ollama hint', async () => {
    const { findByText, getByText, getByTitle } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/projects/p1/export']}>
          <Routes>
            <Route path="/projects/:projectId/export" element={<ExportPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await findByText('Aerial Orbit Around Wooden Church, Kizhi, Russia')).toBeTruthy();
    expect(getByText('Needs review')).toBeTruthy();
    expect(getByText('wooden_church_kizhi_orbit_001.mov')).toBeTruthy();
    expect(getByTitle(/Adobe Stock:.*Too few keywords/s)).toBeTruthy();
    await waitFor(() => expect(getByText(/ollama pull gemma4:31b/)).toBeTruthy());
    expect(getByText('Build archive').hasAttribute('disabled')).toBe(true);
  });

  it('shows an approved clip waiting for a free encoding slot', async () => {
    responses['/api/projects/p1/export'] = {
      ...state,
      clips: state.clips.map((c) => ({ ...c, approved: true })),
    };
    try {
      const { findByText, getByText, queryByText } = render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/projects/p1/export']}>
            <Routes>
              <Route path="/projects/:projectId/export" element={<ExportPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await findByText('Approved · waiting for encoding')).toBeTruthy();
      expect(queryByText('Needs review')).toBeNull();
      expect(getByText('review 0')).toBeTruthy();
      expect(getByText('processing 1')).toBeTruthy();
      expect(getByText('Approve all (0)')).toBeTruthy();

      // E.g. after the encoded files were deleted to free up space.
      fireEvent.click(getByText('Encode 1 approved clip'));
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          '/api/projects/p1/export',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    } finally {
      responses['/api/projects/p1/export'] = state;
    }
  });

  it('regenerates all clips after confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { findByText } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/projects/p1/export']}>
          <Routes>
            <Route path="/projects/:projectId/export" element={<ExportPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await findByText('Regenerate all'));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/projects/p1/export/regenerate',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
