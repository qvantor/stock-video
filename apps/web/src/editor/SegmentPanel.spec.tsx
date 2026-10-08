import { fireEvent, render, screen } from '@testing-library/react';
import type { Segment, SegmentIssue } from '@dfs/contracts';
import { makeSegment } from '../test/utils';
import { SegmentPanel } from './SegmentPanel';

const segments: Segment[] = [
  makeSegment({ id: 'a', startSec: 0, endSec: 10, reasons: ['Smooth forward motion'] }),
  makeSegment({ id: 'b', startSec: 12, endSec: 20, accepted: false, motionType: 'pan_left' }),
  makeSegment({ id: 'c', startSec: 25, endSec: 30, origin: 'user' }),
];

const setup = (
  over: Partial<{
    selected: string[];
    issues: Map<string, SegmentIssue[]>;
    readOnly: boolean;
    segments: Segment[];
  }> = {},
) => {
  const handlers = {
    onSelect: vi.fn(),
    onTimes: vi.fn(),
    onMotion: vi.fn(),
    onToggleAccept: vi.fn(),
    onDelete: vi.fn(),
    onMerge: vi.fn(),
    onLoop: vi.fn(),
  };
  render(
    <SegmentPanel
      segments={over.segments ?? segments}
      selected={new Set(over.selected ?? [])}
      issues={over.issues ?? new Map()}
      readOnly={over.readOnly ?? false}
      {...handlers}
    />,
  );
  return handlers;
};

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('SegmentPanel', () => {
  it('shows a hint when nothing is selected', () => {
    setup();
    expect(screen.getByText(/Select a segment on the timeline/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.getByText('All segments (3)')).toBeTruthy();
  });

  it('shows details of a single selected segment', () => {
    const h = setup({ selected: ['a'] });
    expect(screen.getByText('Duration: 10.00 s')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('Smooth forward motion')).toBeTruthy();
    expect(button('Reject (A)')).toBeTruthy();
    expect(button('Merge (M)').disabled).toBe(true);
    expect(button('Loop').disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Motion type'), { target: { value: 'ascend' } });
    expect(h.onMotion).toHaveBeenCalledWith('ascend');

    const end = screen.getByLabelText('End');
    fireEvent.change(end, { target: { value: '8' } });
    fireEvent.blur(end);
    expect(h.onTimes).toHaveBeenCalledWith('a', 0, 8);

    fireEvent.click(button('Loop'));
    expect(h.onLoop).toHaveBeenCalled();
    fireEvent.click(button('Delete (Del)'));
    expect(h.onDelete).toHaveBeenCalled();
  });

  it('labels the segment origin', () => {
    setup({ selected: ['c'] });
    expect(screen.getByText('manual')).toBeTruthy();
  });

  it('labels edited AI segments', () => {
    setup({ selected: ['a'], segments: [makeSegment({ id: 'a', edited: true })] });
    expect(screen.getByText('AI · edited')).toBeTruthy();
  });

  it('shows a summary and bulk motion select for multiple segments', () => {
    const h = setup({ selected: ['a', 'b'] });
    expect(screen.getByText('Selected segments: 2')).toBeTruthy();
    expect(screen.getByText('Total duration: 18.0 s')).toBeTruthy();
    expect(button('Accept (A)')).toBeTruthy();
    expect(button('Merge (M)').disabled).toBe(false);
    expect(button('Loop').disabled).toBe(true);

    const select = screen.getByLabelText('Set motion type');
    fireEvent.change(select, { target: { value: '' } });
    expect(h.onMotion).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'tilt_up' } });
    expect(h.onMotion).toHaveBeenCalledWith('tilt_up');

    fireEvent.click(button('Merge (M)'));
    expect(h.onMerge).toHaveBeenCalled();
    fireEvent.click(button('Accept (A)'));
    expect(h.onToggleAccept).toHaveBeenCalled();
  });

  it('disables editing in read-only mode but keeps Loop', () => {
    setup({ selected: ['a'], readOnly: true });
    expect(button('Reject (A)').disabled).toBe(true);
    expect(button('Delete (Del)').disabled).toBe(true);
    expect(button('Loop').disabled).toBe(false);
    expect((screen.getByLabelText('Motion type') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Start') as HTMLInputElement).disabled).toBe(true);
  });

  it('lists deduplicated issues of the selection and selects from the list', () => {
    const issue = (segmentId: string, message: string): SegmentIssue => ({
      segmentId,
      kind: 'overlap',
      message,
    });
    const issues = new Map([
      ['a', [issue('a', 'Overlaps another segment')]],
      ['b', [issue('b', 'Overlaps another segment'), issue('b', 'Too short')]],
    ]);
    const h = setup({ selected: ['a', 'b'], issues });
    expect(screen.getAllByText('⚠ Overlaps another segment')).toHaveLength(1);
    expect(screen.getByText('⚠ Too short')).toBeTruthy();

    const list = screen.getAllByRole('listitem').filter((li) => li.querySelector('button'));
    expect(list).toHaveLength(3);
    expect(list[0].textContent).toContain('⚠');
    expect(list[2].textContent).not.toContain('⚠');
    fireEvent.click(list[2].querySelector('button') as HTMLButtonElement);
    expect(h.onSelect).toHaveBeenCalledWith('c');
  });
});
