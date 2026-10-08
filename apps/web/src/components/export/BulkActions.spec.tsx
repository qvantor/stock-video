import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ExportClip } from '@dfs/contracts';
import { makeClip, renderWithProviders, stubFetch } from '../../test/utils';
import { BulkActions } from './BulkActions';

const clips: ExportClip[] = [
  makeClip({ id: 'c1' }),
  makeClip({ id: 'c2', approved: true }),
  makeClip({ id: 'c3', excluded: true }),
  makeClip({ id: 'c4', status: 'llm', metadata: null }),
  makeClip({ id: 'c5' }),
];

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const posted = (calls: { method: string; url: string; body: unknown }[], url: string) =>
  calls.filter((c) => c.method === 'POST' && c.url === url).map((c) => c.body);

describe('BulkActions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('approves every reviewable clip', async () => {
    const { calls } = stubFetch({ 'POST /api/clips/approve': [] });
    renderWithProviders(<BulkActions projectId="p1" clips={clips} selected={new Set()} />);
    fireEvent.click(button('Approve all (2)'));
    await waitFor(() =>
      expect(posted(calls, '/api/clips/approve')).toEqual([{ clipIds: ['c1', 'c5'] }]),
    );
  });

  it('disables approve when nothing is reviewable', () => {
    stubFetch({});
    renderWithProviders(
      <BulkActions projectId="p1" clips={[makeClip({ approved: true })]} selected={new Set()} />,
    );
    expect(button('Approve all (0)').disabled).toBe(true);
  });

  it('replaces a tag on all clips with metadata', async () => {
    const { calls } = stubFetch({ 'POST /api/clips/keywords': [] });
    renderWithProviders(<BulkActions projectId="p1" clips={clips} selected={new Set()} />);
    expect(screen.getByText('Tags of all 3:')).toBeTruthy();
    expect(button('Replace').disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('find tag'), { target: { value: 'church' } });
    fireEvent.change(screen.getByPlaceholderText('replace with (empty = remove)'), {
      target: { value: 'chapel' },
    });
    fireEvent.click(button('Replace'));
    await waitFor(() =>
      expect(posted(calls, '/api/clips/keywords')).toEqual([
        { op: 'replace', clipIds: ['c1', 'c2', 'c5'], find: 'church', replace: 'chapel' },
      ]),
    );
  });

  it('adds and removes a tag on the selected clips and clears the input', async () => {
    const { calls } = stubFetch({ 'POST /api/clips/keywords': [] });
    renderWithProviders(
      <BulkActions projectId="p1" clips={clips} selected={new Set(['c1', 'c3'])} />,
    );
    expect(screen.getByText('Tags of 1 selected:')).toBeTruthy();
    const tag = screen.getByPlaceholderText('tag') as HTMLInputElement;
    expect(button('Add').disabled).toBe(true);

    fireEvent.change(tag, { target: { value: 'lake' } });
    fireEvent.click(button('Add'));
    await waitFor(() => expect(tag.value).toBe(''));

    fireEvent.change(tag, { target: { value: 'boat' } });
    fireEvent.click(button('Remove'));
    await waitFor(() => expect(tag.value).toBe(''));

    expect(posted(calls, '/api/clips/keywords')).toEqual([
      { op: 'add', clipIds: ['c1'], keyword: 'lake' },
      { op: 'remove', clipIds: ['c1'], keyword: 'boat' },
    ]);
  });

  it('shows a server error', async () => {
    stubFetch({
      'POST /api/clips/keywords': new Response(JSON.stringify({ error: 'Too many keywords' }), {
        status: 400,
      }),
    });
    renderWithProviders(<BulkActions projectId="p1" clips={clips} selected={new Set()} />);
    fireEvent.change(screen.getByPlaceholderText('tag'), { target: { value: 'x' } });
    fireEvent.click(button('Add'));
    await screen.findByText('Too many keywords');
  });
});
