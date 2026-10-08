import { fireEvent, render } from '@testing-library/react';
import { TagEditor } from './TagEditor';

describe('TagEditor', () => {
  it('adds lowercase keywords with Enter or commas, skipping duplicates', () => {
    const onChange = vi.fn();
    const { getByPlaceholderText } = render(<TagEditor value={['church']} onChange={onChange} />);
    const input = getByPlaceholderText('add keyword…');
    fireEvent.change(input, { target: { value: 'Lake, CHURCH, island' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['church', 'lake', 'island']);
  });

  it('removes a keyword and shows the counter', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagEditor value={['a', 'b']} onChange={onChange} />,
    );
    expect(getByText('2/50')).toBeTruthy();
    fireEvent.click(getByLabelText('Remove a'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });
});
