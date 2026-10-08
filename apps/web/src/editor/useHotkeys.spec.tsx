import { fireEvent, render, renderHook } from '@testing-library/react';
import { useHotkeys, type HotkeyHandlers } from './useHotkeys';

describe('useHotkeys', () => {
  it('dispatches by physical key code with Mod and Shift prefixes', () => {
    const handlers = { KeyA: vi.fn(), 'Mod+KeyZ': vi.fn(), 'Mod+Shift+KeyZ': vi.fn() };
    renderHook(() => useHotkeys(handlers));
    fireEvent.keyDown(window, { code: 'KeyA', key: 'ф' });
    fireEvent.keyDown(window, { code: 'KeyZ', ctrlKey: true });
    fireEvent.keyDown(window, { code: 'KeyZ', metaKey: true, shiftKey: true });
    expect(handlers.KeyA).toHaveBeenCalledTimes(1);
    expect(handlers['Mod+KeyZ']).toHaveBeenCalledTimes(1);
    expect(handlers['Mod+Shift+KeyZ']).toHaveBeenCalledTimes(1);
  });

  it('prevents default only for handled keys', () => {
    renderHook(() => useHotkeys({ Space: vi.fn() }));
    const handled = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    const unhandled = new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true });
    window.dispatchEvent(handled);
    window.dispatchEvent(unhandled);
    expect(handled.defaultPrevented).toBe(true);
    expect(unhandled.defaultPrevented).toBe(false);
  });

  it('ignores keys typed into form fields', () => {
    const KeyA = vi.fn();
    const Probe = () => {
      useHotkeys({ KeyA });
      return (
        <>
          <input data-testid="input" />
          <textarea data-testid="textarea" />
          <select data-testid="select" />
          <button data-testid="button" />
        </>
      );
    };
    const { getByTestId } = render(<Probe />);
    for (const id of ['input', 'textarea', 'select']) {
      fireEvent.keyDown(getByTestId(id), { code: 'KeyA' });
    }
    expect(KeyA).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId('button'), { code: 'KeyA' });
    expect(KeyA).toHaveBeenCalledTimes(1);
  });

  it('uses the latest handlers without resubscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook((h: HotkeyHandlers) => useHotkeys(h), {
      initialProps: { KeyS: first },
    });
    rerender({ KeyS: second });
    fireEvent.keyDown(window, { code: 'KeyS' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { code: 'KeyS' });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
