import { useEffect, useState } from 'react';
import { formatTimecode, parseTimecode } from '@dfs/contracts';

interface Props {
  value: number;
  disabled?: boolean;
  onCommit: (seconds: number) => void;
  label: string;
}

/** Editable mm:ss.cc field; commits on Enter or blur, Escape reverts. */
export const TimecodeInput = ({ value, disabled, onCommit, label }: Props) => {
  const [text, setText] = useState(formatTimecode(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(formatTimecode(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const t = parseTimecode(text);
    if (t === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (Math.abs(t - value) > 1e-6) onCommit(t);
    else setText(formatTimecode(value));
  };

  return (
    <label className="flex flex-col gap-0.5 text-xs text-neutral-400">
      {label}
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(formatTimecode(value));
            setInvalid(false);
          }
        }}
        className={`tabular rounded border bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-500 disabled:opacity-60 ${
          invalid ? 'border-red-500' : 'border-neutral-700'
        }`}
      />
    </label>
  );
};
