import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AnalysisSettingsSchema, type AnalysisSettings, type Project } from '@dfs/contracts';
import { useReanalyzeProject, useUpdateSettings } from '../api/projects';

const FPS_OPTIONS = [2, 3, 5, 8, 10];

const NumberField = (p: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  suffix?: string;
}) => (
  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="text-neutral-400">{p.label}</span>
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(p.value) ? p.value : ''}
        min={1}
        step={1}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.valueAsNumber)}
        className="tabular w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-right text-neutral-100 outline-none focus:border-sky-500 disabled:opacity-60"
      />
      {p.suffix && <span className="w-3 text-xs text-neutral-500">{p.suffix}</span>}
    </span>
  </label>
);

/** Analysis parameters of the project + "recalculate" for all processed videos. */
export const SettingsPanel = ({ project }: { project: Project }) => {
  const readOnly = project.status !== 'draft';
  const [draft, setDraft] = useState<AnalysisSettings>(project.analysisSettings);
  const update = useUpdateSettings(project.id);
  const reanalyze = useReanalyzeProject(project.id);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setDraft(project.analysisSettings), [project.analysisSettings]);

  const parsed = AnalysisSettingsSchema.safeParse(draft);
  const errors = parsed.success
    ? []
    : z
        .treeifyError(parsed.error)
        .errors.concat(
          Object.values(z.treeifyError(parsed.error).properties ?? {}).flatMap(
            (p) => p?.errors ?? [],
          ),
        );
  const changed = JSON.stringify(draft) !== JSON.stringify(project.analysisSettings);
  const set = <K extends keyof AnalysisSettings>(k: K, v: AnalysisSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onReanalyze = () => {
    if (!parsed.success) return;
    const ok = window.confirm(
      'Recalculate segments of all processed videos with these parameters?\n' +
        'AI segments you have not touched will be replaced. Manually created or edited segments are kept.',
    );
    if (!ok) return;
    setNotice(null);
    reanalyze.mutate(parsed.data, {
      onSuccess: (r) =>
        setNotice(
          r.queued > 0
            ? `Recalculated: ${r.segmented}, queued for re-analysis: ${r.queued}`
            : `Videos recalculated: ${r.segmented}`,
        ),
    });
  };

  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Analysis parameters
      </h2>
      <div className="space-y-2">
        <NumberField
          label="Min length"
          suffix="s"
          value={draft.minDuration}
          disabled={readOnly}
          onChange={(v) => set('minDuration', v)}
        />
        <NumberField
          label="Max length"
          suffix="s"
          value={draft.maxDuration}
          disabled={readOnly}
          onChange={(v) => set('maxDuration', v)}
        />
        <NumberField
          label="Target length"
          suffix="s"
          value={draft.targetDuration}
          disabled={readOnly}
          onChange={(v) => set('targetDuration', v)}
        />
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-neutral-400">Analysis rate</span>
          <select
            value={draft.analysisFps}
            disabled={readOnly}
            onChange={(e) => set('analysisFps', Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-100"
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="flex justify-between text-neutral-400">
            Sensitivity{' '}
            <span className="tabular text-neutral-200">×{draft.sensitivity.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={draft.sensitivity}
            disabled={readOnly}
            onChange={(e) => set('sensitivity', e.target.valueAsNumber)}
            className="w-full accent-sky-500"
          />
          <span className="flex justify-between text-[10px] text-neutral-500">
            <span>more tolerant</span>
            <span>stricter</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={draft.includeStatic}
            disabled={readOnly}
            onChange={(e) => set('includeStatic', e.target.checked)}
            className="accent-sky-500"
          />
          Include hovering shots
        </label>
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 text-xs text-red-400">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {draft.analysisFps !== project.analysisSettings.analysisFps && (
        <p className="mt-2 text-xs text-amber-400">
          A new analysis rate requires re-running the frame-by-frame analysis (slower).
        </p>
      )}
      {!readOnly && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={!changed || !parsed.success || update.isPending}
            onClick={() => parsed.success && update.mutate(parsed.data)}
            className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40"
          >
            Save
          </button>
          <button
            disabled={!parsed.success || reanalyze.isPending}
            onClick={onReanalyze}
            className="rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600 disabled:opacity-40"
          >
            {reanalyze.isPending ? 'Recalculating…' : 'Recalculate'}
          </button>
        </div>
      )}
      {(update.error ?? reanalyze.error) && (
        <p className="mt-2 text-xs text-red-400">{(update.error ?? reanalyze.error)?.message}</p>
      )}
      {notice && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}
    </section>
  );
};
