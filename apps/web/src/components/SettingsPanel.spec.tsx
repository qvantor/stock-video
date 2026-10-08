import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { makeProject, renderWithProviders, stubFetch } from '../test/utils';
import { SettingsPanel } from './SettingsPanel';

const project = makeProject();

const field = (label: string) =>
  screen.getByText(label).closest('label')?.querySelector('input, select') as
    HTMLInputElement | HTMLSelectElement;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('SettingsPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disables all fields and hides actions when the project is confirmed', () => {
    stubFetch({});
    renderWithProviders(<SettingsPanel project={makeProject({ status: 'confirmed' })} />);
    expect((field('Min length') as HTMLInputElement).disabled).toBe(true);
    expect((field('Analysis rate') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('enables Save only after a change and sends the new settings', async () => {
    const { calls } = stubFetch({
      'PUT /api/projects/p1/settings': (body) => ({ ...project, analysisSettings: body }),
    });
    renderWithProviders(<SettingsPanel project={project} />);
    expect(button('Save').disabled).toBe(true);

    fireEvent.change(field('Target length'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Include hovering shots'));
    expect(button('Save').disabled).toBe(false);
    fireEvent.click(button('Save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      ...project.analysisSettings,
      targetDuration: 30,
      includeStatic: true,
    });
  });

  it('shows validation errors and blocks saving', () => {
    stubFetch({});
    renderWithProviders(<SettingsPanel project={project} />);
    fireEvent.change(field('Min length'), { target: { value: '50' } });
    expect(screen.getByText('minDuration must be less than maxDuration')).toBeTruthy();
    expect(button('Save').disabled).toBe(true);
    expect(button('Recalculate').disabled).toBe(true);
  });

  it('warns that a new analysis rate needs a full re-analysis', () => {
    stubFetch({});
    renderWithProviders(<SettingsPanel project={project} />);
    expect(screen.queryByText(/A new analysis rate requires/)).toBeNull();
    fireEvent.change(field('Analysis rate'), { target: { value: '10' } });
    expect(screen.getByText(/A new analysis rate requires/)).toBeTruthy();
  });

  it('recalculates after confirmation and reports the result', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { calls } = stubFetch({
      'POST /api/projects/p1/reanalyze': { segmented: 3, queued: 1 },
    });
    renderWithProviders(<SettingsPanel project={project} />);

    fireEvent.click(button('Recalculate'));
    expect(confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    confirm.mockReturnValue(true);
    fireEvent.click(button('Recalculate'));
    await screen.findByText('Recalculated: 3, queued for re-analysis: 1');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual(project.analysisSettings);
  });

  it('reports a recalculation without queued videos', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    stubFetch({ 'POST /api/projects/p1/reanalyze': { segmented: 2, queued: 0 } });
    renderWithProviders(<SettingsPanel project={project} />);
    fireEvent.click(button('Recalculate'));
    await screen.findByText('Videos recalculated: 2');
  });

  it('shows a server error', async () => {
    stubFetch({
      'PUT /api/projects/p1/settings': new Response(
        JSON.stringify({ error: 'Project is confirmed' }),
        {
          status: 409,
        },
      ),
    });
    renderWithProviders(<SettingsPanel project={project} />);
    fireEvent.click(screen.getByLabelText('Include hovering shots'));
    fireEvent.click(button('Save'));
    await screen.findByText('Project is confirmed');
  });

  it('resyncs the draft when the project settings change', () => {
    stubFetch({});
    const next = makeProject({
      analysisSettings: { ...project.analysisSettings, minDuration: 12 },
    });
    const Switcher = () => {
      const [p, setP] = useState(project);
      return (
        <>
          <button onClick={() => setP(next)}>swap</button>
          <SettingsPanel project={p} />
        </>
      );
    };
    renderWithProviders(<Switcher />);
    fireEvent.change(field('Min length'), { target: { value: '9' } });
    fireEvent.click(button('swap'));
    expect((field('Min length') as HTMLInputElement).value).toBe('12');
  });
});
