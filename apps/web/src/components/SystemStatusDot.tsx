import clsx from 'clsx';
import type { SystemCheck } from '@dfs/contracts';
import { useSystemStatus } from '../api/status';

type Tone = 'ok' | 'partial' | 'down' | 'pending';

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/60',
  partial: 'bg-amber-500 shadow-[0_0_6px] shadow-amber-500/60',
  down: 'bg-red-500 shadow-[0_0_6px] shadow-red-500/60',
  pending: 'bg-neutral-600',
};

const SUMMARY_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-400',
  partial: 'text-amber-400',
  down: 'text-red-400',
  pending: 'text-neutral-400',
};

const API_DOWN: SystemCheck = {
  id: 'api',
  label: 'API',
  ok: false,
  message: 'The server is not reachable.',
};

/** Green: all systems healthy, yellow: some down, red: all down (or the API is unreachable). */
export const SystemStatusDot = () => {
  const { data, isError } = useSystemStatus();

  let tone: Tone = 'pending';
  let summary = 'Checking systems…';
  let checks: SystemCheck[] = [];
  if (isError && !data) {
    tone = 'down';
    summary = 'API is not reachable';
    checks = [API_DOWN];
  } else if (data) {
    checks = data.checks;
    const down = checks.filter((c) => !c.ok).length;
    tone = down === 0 ? 'ok' : down === checks.length ? 'down' : 'partial';
    summary = down === 0 ? 'All systems healthy' : `${down} of ${checks.length} systems down`;
  }

  return (
    <div className="group relative flex items-center">
      <span
        role="status"
        tabIndex={0}
        aria-label={summary}
        className={clsx('block h-2.5 w-2.5 cursor-default rounded-full outline-none', DOT[tone])}
      />
      <div
        className={clsx(
          'pointer-events-none invisible absolute top-full right-0 z-20 mt-2 w-80 rounded-lg border border-neutral-800',
          'bg-neutral-900/95 p-3 opacity-0 shadow-xl shadow-black/40 backdrop-blur transition-opacity duration-100',
          'group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
        )}
      >
        <div className={clsx('mb-2 text-sm font-medium', SUMMARY_TEXT[tone])}>{summary}</div>
        {checks.length > 0 && (
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span
                  className={clsx(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    c.ok ? 'bg-emerald-500' : 'bg-red-500',
                  )}
                />
                <div className="min-w-0">
                  <div className="text-xs text-neutral-200">{c.label}</div>
                  {c.message && (
                    <div
                      className={clsx(
                        'text-xs break-words',
                        c.ok ? 'text-neutral-500' : 'text-red-300/90',
                      )}
                    >
                      {c.message}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
