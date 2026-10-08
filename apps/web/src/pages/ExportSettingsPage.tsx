import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExportSettingsSchema, type ExportSettings } from '@dfs/contracts';
import {
  useExportHealth,
  useExportSettings,
  useSaveExportSettings,
  useStockPlatforms,
} from '../api/export';

const field =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-500';

const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="grid items-center gap-1 py-1.5 sm:grid-cols-[220px_1fr] sm:gap-4">
    <span className="text-sm text-neutral-300">
      {label}
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
    </span>
    {children}
  </label>
);

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-lg border border-neutral-800 px-4 py-3">
    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
    {children}
  </section>
);

const Num = ({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) => (
  <input
    type="number"
    value={Number.isFinite(value) ? value : ''}
    step={step}
    onChange={(e) => onChange(e.target.valueAsNumber)}
    className={`${field} tabular max-w-[140px]`}
  />
);

const Check = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <span className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-sky-500"
    />
    {label}
  </span>
);

/** Global settings of stage 2 (model, encoding, naming, CSV values, geo). */
export const ExportSettingsPage = () => {
  const { data: settings, error } = useExportSettings();
  const { data: platforms } = useStockPlatforms();
  const { data: health } = useExportHealth();
  const save = useSaveExportSettings();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ExportSettings | null>(null);
  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (error) return <div className="p-8 text-red-400">{error.message}</div>;
  if (!draft || !settings) return <div className="p-8 text-neutral-500">Loading…</div>;

  const set = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setEnc = <K extends keyof ExportSettings['encoding']>(
    k: K,
    v: ExportSettings['encoding'][K],
  ) => setDraft((d) => (d ? { ...d, encoding: { ...d.encoding, [k]: v } } : d));
  const parsed = ExportSettingsSchema.safeParse(draft);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-neutral-400 hover:text-neutral-100">
          ← Back
        </button>
        <h1 className="flex-1 text-xl font-semibold text-neutral-100">Export settings</h1>
        <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-100">
          Projects
        </Link>
      </div>

      <Group title="Local model (Ollama)">
        <Row label="Ollama URL" hint="From Docker: http://host.docker.internal:11434">
          <input
            value={draft.ollamaUrl}
            onChange={(e) => set('ollamaUrl', e.target.value)}
            className={field}
          />
        </Row>
        <Row label="Model">
          <input
            value={draft.model}
            onChange={(e) => set('model', e.target.value)}
            className={field}
          />
        </Row>
        <Row label="Thinking mode" hint="Slower; off by default">
          <Check checked={draft.think} onChange={(v) => set('think', v)} label="Enable thinking" />
        </Row>
        <Row label="Temperature">
          <Num value={draft.temperature} step={0.05} onChange={(v) => set('temperature', v)} />
        </Row>
        <Row label="Timeout per request" hint="seconds">
          <Num value={draft.llmTimeoutSec} onChange={(v) => set('llmTimeoutSec', v)} />
        </Row>
        <Row label="Keep alive" hint="How long Ollama keeps the model loaded, e.g. 30m">
          <input
            value={draft.keepAlive}
            onChange={(e) => set('keepAlive', e.target.value)}
            className={`${field} max-w-[140px]`}
          />
        </Row>
        {health && (
          <p className={health.ok ? 'text-xs text-emerald-400' : 'text-xs text-amber-300'}>
            {health.ok ? `Ollama is reachable, ${health.model} is installed.` : health.message}
          </p>
        )}
      </Group>

      <Group title="Workflow">
        <Row label="Auto-approve" hint="Cut right after the metadata is generated, without review">
          <Check
            checked={draft.autoApprove}
            onChange={(v) => set('autoApprove', v)}
            label="Skip manual review"
          />
        </Row>
        <Row label="Parallel clips" hint="Frames/geo/cutting; LLM calls are always one at a time">
          <Num value={draft.concurrency} onChange={(v) => set('concurrency', v)} />
        </Row>
      </Group>

      <Group title="Encoding">
        <Row label="Codec">
          <select
            value={draft.encoding.codec}
            onChange={(e) => setEnc('codec', e.target.value as ExportSettings['encoding']['codec'])}
            className={`${field} max-w-[260px]`}
          >
            <option value="h264">H.264 High, 8-bit 4:2:0</option>
            <option value="prores_hq">ProRes 422 HQ</option>
          </select>
        </Row>
        {draft.encoding.codec === 'h264' && (
          <>
            <Row label="Quality (CRF)" hint="Lower = better, 14–18 is visually lossless">
              <Num value={draft.encoding.crf} onChange={(v) => setEnc('crf', v)} />
            </Row>
            <Row label="Max bitrate at 4K" hint="Mbps, scaled down for smaller frames">
              <Num
                value={draft.encoding.maxBitrateMbps}
                onChange={(v) => setEnc('maxBitrateMbps', v)}
              />
            </Row>
          </>
        )}
        <Row label="Container">
          <select
            value={draft.encoding.container}
            onChange={(e) =>
              setEnc('container', e.target.value as ExportSettings['encoding']['container'])
            }
            className={`${field} max-w-[140px]`}
          >
            <option value="mov">.mov</option>
            <option value="mp4">.mp4</option>
          </select>
        </Row>
        <Row label="Slow-motion conform" hint="≥100 fps footage played back at 25/30 fps">
          <select
            value={draft.slowMoConform}
            onChange={(e) =>
              set('slowMoConform', e.target.value as ExportSettings['slowMoConform'])
            }
            className={`${field} max-w-[140px]`}
          >
            <option value="off">Off</option>
            <option value="25">25 fps</option>
            <option value="30">30 fps</option>
          </select>
        </Row>
        <Row label="GPS in delivered files">
          <Check
            checked={draft.embedGps}
            onChange={(v) => set('embedGps', v)}
            label="Keep GPS metadata"
          />
        </Row>
        <Row label="Capture time" hint="DJI writes local time labelled as UTC">
          <select
            value={draft.creationTimeMode}
            onChange={(e) =>
              set('creationTimeMode', e.target.value as ExportSettings['creationTimeMode'])
            }
            className={`${field} max-w-[260px]`}
          >
            <option value="auto">Auto (DJI = local time)</option>
            <option value="utc">Always UTC</option>
            <option value="local">Always local time</option>
          </select>
        </Row>
        <Row label="File name template" hint="{subject} {place} {motion} {date} {n}">
          <input
            value={draft.filenameTemplate}
            onChange={(e) => set('filenameTemplate', e.target.value)}
            className={field}
          />
        </Row>
      </Group>

      <Group title="Stock platforms">
        <Row label="Enabled platforms">
          <span className="flex flex-wrap gap-4">
            {platforms?.map((p) => (
              <Check
                key={p.id}
                label={`${p.label}${p.verified ? '' : ' *'}`}
                checked={draft.enabledPlatforms.includes(p.id)}
                onChange={(on) =>
                  set(
                    'enabledPlatforms',
                    on
                      ? [...draft.enabledPlatforms, p.id]
                      : draft.enabledPlatforms.filter((id) => id !== p.id),
                  )
                }
              />
            ))}
          </span>
        </Row>
        {platforms?.some((p) => !p.verified) && (
          <p className="text-xs text-neutral-500">
            * CSV layout not yet verified against the official template.
          </p>
        )}
        <Row label="Adobe Stock author" hint="Used in the Adobe CSV file name">
          <input
            value={draft.adobeAuthor}
            onChange={(e) => set('adobeAuthor', e.target.value)}
            className={field}
          />
        </Row>
        <Row label="Copyright" hint="Pond5">
          <input
            value={draft.copyright}
            onChange={(e) => set('copyright', e.target.value)}
            className={field}
          />
        </Row>
        <Row label="Pond5 price / large" hint="USD">
          <span className="flex gap-2">
            <Num value={draft.pond5Price} onChange={(v) => set('pond5Price', v)} />
            <Num value={draft.pond5PriceLarge} onChange={(v) => set('pond5PriceLarge', v)} />
          </span>
        </Row>
        <Row label="Envato single / multi-use" hint="USD">
          <span className="flex gap-2">
            <Num value={draft.envatoPriceSingle} onChange={(v) => set('envatoPriceSingle', v)} />
            <Num value={draft.envatoPriceMulti} onChange={(v) => set('envatoPriceMulti', v)} />
          </span>
        </Row>
      </Group>

      <Group title="Location">
        <Row label="Landmark search radius" hint="metres">
          <Num value={draft.poiRadiusM} step={100} onChange={(v) => set('poiRadiusM', v)} />
        </Row>
        <Row label="Nominatim User-Agent" hint="Must identify you, e.g. app name + your e-mail">
          <input
            value={draft.nominatimUserAgent}
            onChange={(e) => set('nominatimUserAgent', e.target.value)}
            className={field}
          />
        </Row>
        <Row label="OpenStreetMap objects">
          <Check
            checked={draft.useOverpass}
            onChange={(v) => set('useOverpass', v)}
            label="Also query Overpass API"
          />
        </Row>
      </Group>

      {errors.length > 0 && (
        <ul className="text-sm text-red-400">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {save.error && <p className="text-sm text-red-400">{save.error.message}</p>}
      <div className="flex gap-2">
        <button
          disabled={!changed || !parsed.success || save.isPending}
          onClick={() => parsed.success && save.mutate(parsed.data)}
          className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          disabled={!changed}
          onClick={() => setDraft(settings)}
          className="rounded px-4 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          Reset
        </button>
        {save.isSuccess && !changed && (
          <span className="self-center text-sm text-emerald-400">Saved</span>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Changed settings apply to clips processed from now on; finished steps are re-run only when
        their inputs change.
      </p>
    </div>
  );
};
