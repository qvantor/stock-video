import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ExportClip, GeoContext, StockCategories, TechContext } from '@dfs/contracts';
import { makeClip, renderWithProviders, stubFetch, type FetchCall } from '../../test/utils';
import { ClipDrawer } from './ClipDrawer';

type FetchRoutes = Parameters<typeof stubFetch>[0];

const categories: StockCategories = {
  adobe: [
    { id: 1, label: 'Animals' },
    { id: 2, label: 'Buildings and Architecture' },
  ],
  shutterstock: ['Buildings/Landmarks', 'Nature', 'Travel'],
  envato: ['Buildings', 'Nature'],
};

const geo: GeoContext = {
  source: 'embedded',
  lat: 62.066,
  lon: 35.224,
  altitudeM: 120,
  city: 'Kizhi',
  region: 'Karelia',
  country: 'Russia',
  countryCode: 'ru',
  displayName: null,
  localName: 'Кижи',
  manualText: null,
  cameraHeadingDeg: 90,
  poiCandidates: [
    {
      name: 'Церковь Преображения',
      nameEn: 'Church of the Transfiguration',
      type: 'church',
      distanceM: 350,
      bearingDeg: 88.6,
      inCameraSector: true,
      wikidataId: null,
    },
    {
      name: 'Остров',
      nameEn: 'Kizhi Island',
      type: 'island',
      distanceM: 2500,
      bearingDeg: 10,
      inCameraSector: null,
      wikidataId: null,
    },
  ],
};

const tech: TechContext = {
  durationSec: 20,
  sourceDurationSec: 20,
  fps: 59.94,
  outputFps: 29.97,
  width: 3840,
  height: 2160,
  resolutionLabel: '4K',
  codec: 'h264',
  bitDepth: 10,
  colorTransfer: 'hlg',
  hasAudio: false,
  shotType: 'slow_motion',
  motionType: 'orbit_left',
  movement: ['Orbit'],
  timeOfDay: 'golden_hour',
  season: 'summer',
  capturedAt: null,
  captureDate: '2024-07-15',
  altitudeM: 120,
  droneModel: 'Mavic 3',
};

const metadataOf = (clip: ExportClip) => {
  if (!clip.metadata) throw new Error('clip has no metadata');
  return clip.metadata;
};

const setup = (clip: ExportClip, routes: FetchRoutes = {}) => {
  const onClose = vi.fn();
  const fetch = stubFetch({
    'PATCH /api/clips/c1/metadata': (body: unknown) =>
      makeClip({ ...clip, metadata: { ...metadataOf(clip), ...(body as object) } }),
    'POST /api/clips/approve': [],
    ...routes,
  });
  const view = renderWithProviders(
    <ClipDrawer
      projectId="p1"
      clip={clip}
      video={undefined}
      categories={categories}
      platforms={undefined}
      onClose={onClose}
    />,
  );
  return { ...view, ...fetch, onClose };
};

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const input = (label: string) =>
  screen
    .getByText(label, { exact: false })
    .closest('label')
    ?.querySelector('input, textarea, select') as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const mutations = (calls: FetchCall[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);

describe('ClipDrawer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closes on Escape, the Close button and a backdrop click, but not inside', () => {
    const { onClose, container } = setup(makeClip());
    fireEvent.click(screen.getByText('Metadata'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('.fixed') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('shows the header, a fallback without proxy and no frames', () => {
    setup(makeClip({ ordinal: 2, startSec: 5, endSec: 25 }));
    expect(screen.getByText('#3 · DJI_0042.MP4')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('no proxy')).toBeTruthy();
    expect(screen.getByText('Frames not extracted yet.')).toBeTruthy();
    expect(screen.getByText('Not determined yet.')).toBeTruthy();
  });

  it('saves an edited draft and can discard changes', async () => {
    const { calls } = setup(makeClip());
    expect(button('Save').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();

    fireEvent.change(input('Title'), { target: { value: 'New title' } });
    expect(button('Save & approve')).toBeTruthy();
    fireEvent.click(button('Discard changes'));
    expect((input('Title') as HTMLInputElement).value).toBe(
      'Aerial Orbit Around Wooden Church, Kizhi, Russia',
    );

    fireEvent.change(input('Title'), { target: { value: 'New title' } });
    fireEvent.click(input('Editorial'));
    fireEvent.click(button('Save'));
    await waitFor(() => expect(mutations(calls)).toEqual(['PATCH /api/clips/c1/metadata']));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      title: 'New title',
      editorial: true,
      keywords: ['church', 'kizhi'],
      adobeCategory: 2,
    });
  });

  it('shows character counters that turn red over the limit', () => {
    setup(makeClip());
    fireEvent.change(input('Title'), { target: { value: 'x'.repeat(71) } });
    const counter = screen.getByText('71/70');
    expect(counter.className).toContain('text-red-400');
    expect(screen.getByText('29/200').className).not.toContain('text-red-400');
  });

  it('blocks saving with too many keywords', () => {
    const clip = makeClip();
    const keywords = Array.from({ length: 51 }, (_, i) => `k${i}`);
    setup({ ...clip, metadata: { ...metadataOf(clip), keywords } });
    fireEvent.change(input('Title'), { target: { value: 'Changed' } });
    expect(button('Save').disabled).toBe(true);
  });

  it('saves before approving', async () => {
    const { calls } = setup(makeClip());
    fireEvent.change(input('Subject'), { target: { value: 'chapel' } });
    fireEvent.click(button('Save & approve'));
    await waitFor(() =>
      expect(mutations(calls)).toEqual(['PATCH /api/clips/c1/metadata', 'POST /api/clips/approve']),
    );
    expect(calls.at(-1)?.body).toEqual({ clipIds: ['c1'] });
  });

  it('does not approve when saving fails', async () => {
    const { calls } = setup(makeClip(), {
      'PATCH /api/clips/c1/metadata': new Response(JSON.stringify({ error: 'Invalid title' }), {
        status: 400,
      }),
    });
    fireEvent.change(input('Title'), { target: { value: 'x' } });
    fireEvent.click(button('Save & approve'));
    await screen.findByText('Invalid title');
    expect(mutations(calls)).toEqual(['PATCH /api/clips/c1/metadata']);
  });

  it('approves directly when nothing changed', async () => {
    const { calls } = setup(makeClip());
    fireEvent.click(button('Approve'));
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/clips/approve']));
  });

  it('retries a failed step', async () => {
    const clip = makeClip({ status: 'failed', failedStep: 'llm', error: 'Model timeout' });
    const { calls } = setup(clip, { 'POST /api/clips/c1/retry': clip });
    expect(screen.getByText('Failed at “llm”: Model timeout')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(button('Retry step'));
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/clips/c1/retry']));
  });

  it('toggles exclusion', async () => {
    const clip = makeClip({ excluded: true });
    const { calls } = setup(clip, { 'POST /api/clips/c1/exclude': clip });
    expect(button('Approve').disabled).toBe(true);
    fireEvent.click(button('Include in export'));
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/clips/c1/exclude']));
    expect(calls.at(-1)?.body).toEqual({ excluded: false });
  });

  it('shows location and landmark candidates and regenerates with a chosen subject', async () => {
    const clip = makeClip({ context: { frames: null, geo, tech } });
    const { calls } = setup(clip, { 'POST /api/clips/c1/regenerate': clip });
    expect(screen.getByText('Kizhi, Karelia, Russia')).toBeTruthy();
    expect(screen.getByText(/GPS from file · Кижи/)).toBeTruthy();
    expect(screen.getByText(/church · 350 m · 89° · in view/)).toBeTruthy();
    expect(screen.getByText(/island · 2.5 km · 10°/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Hint for the model/), {
      target: { value: 'wooden church' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Use as subject' })[0]);
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/clips/c1/regenerate']));
    expect(calls.at(-1)?.body).toEqual({
      poiName: 'Church of the Transfiguration',
      hint: 'wooden church',
    });
  });

  it('regenerates with only a hint', async () => {
    const clip = makeClip({ context: { frames: null, geo: null, tech }, userHint: 'old hint' });
    const { calls } = setup(clip, { 'POST /api/clips/c1/regenerate': clip });
    expect(screen.getByText('Last hint: old hint')).toBeTruthy();
    fireEvent.click(button('Regenerate'));
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/clips/c1/regenerate']));
    expect(calls.at(-1)?.body).toEqual({});
  });

  it('disables regeneration without technical context or while busy', () => {
    const { unmount } = setup(makeClip());
    expect(button('Regenerate').disabled).toBe(true);
    unmount();
    setup(makeClip({ status: 'geo', context: { frames: null, geo, tech } }));
    expect(button('Regenerate').disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Use as subject' })[0]).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the technical summary', () => {
    setup(
      makeClip({ outputSizeBytes: 5 * 1024 * 1024, context: { frames: null, geo: null, tech } }),
    );
    expect(screen.getByText('Slow motion')).toBeTruthy();
    expect(screen.getByText('4K · 3840×2160 · 59.94 fps → 29.97 fps')).toBeTruthy();
    expect(screen.getByText('0:20 · 5.0 MB')).toBeTruthy();
    expect(screen.getByText('Golden hour · summer')).toBeTruthy();
    expect(screen.getByText('2024-07-15 · Mavic 3')).toBeTruthy();
    expect(screen.getByText('10-bit · hlg')).toBeTruthy();
  });

  it('keeps at most two distinct Shutterstock categories', async () => {
    const { calls } = setup(makeClip());
    fireEvent.change(input('Shutterstock category 2'), { target: { value: 'Nature' } });
    fireEvent.change(input('Shutterstock category 1'), { target: { value: 'Nature' } });
    expect((input('Shutterstock category 2') as HTMLSelectElement).value).toBe('');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      shutterstockCategories: ['Nature'],
    });
  });

  it('warns about editorial suggestions and low place confidence', () => {
    const clip = makeClip();
    setup({
      ...clip,
      metadata: {
        ...metadataOf(clip),
        editorialSuggested: true,
        editorialReason: 'Visible logos',
        placeConfidence: 'low',
      },
    });
    expect(screen.getByText('The model suggests editorial: Visible logos')).toBeTruthy();
    expect(screen.getByText(/Place confidence: low/)).toBeTruthy();
  });

  it('shows a placeholder while the model is writing', () => {
    setup(makeClip({ status: 'llm', metadata: null }));
    expect(screen.getByText('The model is writing the metadata…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('replaces the draft on clip updates only when it is not dirty', () => {
    stubFetch({});
    const clip = makeClip();
    const withTitle = (title: string) => ({ ...clip, metadata: { ...metadataOf(clip), title } });
    const Harness = () => {
      const [c, setC] = useState(clip);
      return (
        <>
          <button onClick={() => setC(withTitle('Server title A'))}>update A</button>
          <button onClick={() => setC(withTitle('Server title B'))}>update B</button>
          <ClipDrawer
            projectId="p1"
            clip={c}
            video={undefined}
            categories={categories}
            platforms={undefined}
            onClose={() => undefined}
          />
        </>
      );
    };
    renderWithProviders(<Harness />);
    fireEvent.click(button('update A'));
    expect((input('Title') as HTMLInputElement).value).toBe('Server title A');

    fireEvent.change(input('Title'), { target: { value: 'My edit' } });
    fireEvent.click(button('update B'));
    expect((input('Title') as HTMLInputElement).value).toBe('My edit');
  });
});
