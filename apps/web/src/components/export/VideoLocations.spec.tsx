import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ExportVideo } from '@dfs/contracts';
import { renderWithProviders, stubFetch } from '../../test/utils';
import { VideoLocations } from './VideoLocations';

const video = (over: Partial<ExportVideo> = {}): ExportVideo => ({
  id: 'v1',
  originalFilename: 'DJI_0001.MP4',
  manualLocation: null,
  embeddedLocation: null,
  creationTime: null,
  droneModel: null,
  ...over,
});

const apply = () => screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;

describe('VideoLocations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows GPS info and a matching placeholder', () => {
    stubFetch({});
    renderWithProviders(
      <VideoLocations
        projectId="p1"
        videos={[
          video({ id: 'v1', embeddedLocation: { lat: 62.06624, lon: 35.22351 } }),
          video({ id: 'v2', originalFilename: 'DJI_0002.MP4' }),
        ]}
      />,
    );
    expect(screen.getByText('GPS 62.0662, 35.2235')).toBeTruthy();
    expect(screen.getByText('no GPS in file')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Override: city / landmark / country or lat, lon'),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('City / landmark / country or lat, lon')).toBeTruthy();
  });

  it('applies a trimmed location only after a change', async () => {
    const { calls } = stubFetch({ 'PATCH /api/videos/v1/location': {} });
    renderWithProviders(<VideoLocations projectId="p1" videos={[video()]} />);
    expect(apply().disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Kizhi  ' } });
    fireEvent.click(apply());
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ location: 'Kizhi' });
  });

  it('clears the location with Enter on an empty value', async () => {
    const { calls } = stubFetch({ 'PATCH /api/videos/v1/location': {} });
    renderWithProviders(
      <VideoLocations projectId="p1" videos={[video({ manualLocation: 'Kizhi' })]} />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Kizhi');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ location: null });
  });

  it('shows a server error', async () => {
    stubFetch({
      'PATCH /api/videos/v1/location': new Response(JSON.stringify({ error: 'Bad location' }), {
        status: 400,
      }),
    });
    renderWithProviders(<VideoLocations projectId="p1" videos={[video()]} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(apply());
    await screen.findByText('Bad location');
  });
});
