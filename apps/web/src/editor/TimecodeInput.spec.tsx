import { fireEvent, render, screen } from '@testing-library/react';
import { TimecodeInput } from './TimecodeInput';

const input = () => screen.getByLabelText('Start') as HTMLInputElement;

describe('TimecodeInput', () => {
  it('shows the formatted value', () => {
    render(<TimecodeInput label="Start" value={65.5} onCommit={vi.fn()} />);
    expect(input().value).toBe('01:05.50');
  });

  it('commits the parsed seconds on Enter', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput label="Start" value={0} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: '1:30' } });
    input().focus();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(90);
  });

  it('commits on blur', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput label="Start" value={0} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: '12.25' } });
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(12.25);
  });

  it('does not commit an unchanged value and reformats it', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput label="Start" value={5} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: '5' } });
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('00:05.00');
  });

  it('marks invalid input and does not commit', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput label="Start" value={5} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().className).toContain('border-red-500');
  });

  it('reverts on Escape', () => {
    render(<TimecodeInput label="Start" value={5} onCommit={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.blur(input());
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('00:05.00');
    expect(input().className).not.toContain('border-red-500');
  });

  it('resyncs when the value prop changes', () => {
    const { rerender } = render(<TimecodeInput label="Start" value={5} onCommit={vi.fn()} />);
    fireEvent.change(input(), { target: { value: '9' } });
    rerender(<TimecodeInput label="Start" value={10} onCommit={vi.fn()} />);
    expect(input().value).toBe('00:10.00');
  });

  it('can be disabled', () => {
    render(<TimecodeInput label="Start" value={5} disabled onCommit={vi.fn()} />);
    expect(input().disabled).toBe(true);
  });
});
