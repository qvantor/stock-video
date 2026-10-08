import { useEffect, useRef } from 'react';

export type HotkeyHandlers = Partial<Record<string, (e: KeyboardEvent) => void>>;

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

/**
 * Global editor shortcuts keyed by physical key (`KeyboardEvent.code`) so they
 * work with any keyboard layout (e.g. Russian). Key format:
 * `[Mod+][Shift+]<code>` where Mod = Cmd on macOS / Ctrl elsewhere.
 */
export const useHotkeys = (handlers: HotkeyHandlers): void => {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const combo = `${mod ? 'Mod+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
      const handler = ref.current[combo];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};
