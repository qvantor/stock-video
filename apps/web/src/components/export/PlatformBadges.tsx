import clsx from 'clsx';
import type { PlatformValidation, StockPlatformInfo } from '@dfs/contracts';

const TONE = {
  ok: 'border-emerald-700 bg-emerald-950/60 text-emerald-300',
  warning: 'border-amber-700 bg-amber-950/60 text-amber-300',
  error: 'border-red-700 bg-red-950/60 text-red-300',
} as const;

const SHORT: Record<string, string> = {
  adobe: 'AS',
  shutterstock: 'SS',
  pond5: 'P5',
  envato: 'EN',
};

/** One badge per enabled platform: green / warning / error with the messages on hover. */
export const PlatformBadges = ({
  validations,
  platforms,
}: {
  validations: PlatformValidation[];
  platforms: StockPlatformInfo[] | undefined;
}) => {
  if (!validations.length) return <span className="text-xs text-neutral-600">—</span>;
  return (
    <span className="flex gap-1">
      {validations.map((v) => {
        const label = platforms?.find((p) => p.id === v.platform)?.label ?? v.platform;
        const title = v.messages.length
          ? `${label}:\n• ${v.messages.join('\n• ')}`
          : `${label}: OK`;
        return (
          <span
            key={v.platform}
            title={title}
            className={clsx(
              'cursor-help rounded border px-1 py-px text-[10px] font-semibold',
              TONE[v.level],
            )}
          >
            {SHORT[v.platform] ?? v.platform.slice(0, 2).toUpperCase()}
          </span>
        );
      })}
    </span>
  );
};
