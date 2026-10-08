import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type {
  ClipMetadataPatch,
  ExportClip,
  SourceVideo,
  StockCategories,
  StockPlatformInfo,
} from '@dfs/contracts';
import { formatTimecode } from '@dfs/contracts';
import {
  usePatchMetadata,
  useApprove,
  useExclude,
  useRegenerate,
  useRetryClip,
} from '../../api/export';
import { formatBytes, formatDuration } from '../../lib/format';
import {
  clipStatusLabel,
  clipStatusTone,
  isAwaitingCut,
  KEYWORD_LIMIT,
  SHOT_LABEL,
  TIME_LABEL,
} from './labels';
import { PlatformBadges } from './PlatformBadges';
import { SegmentPlayer } from './SegmentPlayer';
import { TagEditor } from './TagEditor';

interface Draft {
  title: string;
  description: string;
  subject: string;
  keywords: string[];
  adobeCategory: number;
  shutterstockCategories: string[];
  envatoCategory: string;
  recognizableBuildings: boolean;
  editorial: boolean;
}

const draftOf = (clip: ExportClip): Draft | null =>
  clip.metadata
    ? {
        title: clip.metadata.title,
        description: clip.metadata.description,
        subject: clip.metadata.subject,
        keywords: clip.metadata.keywords,
        adobeCategory: clip.metadata.adobeCategory,
        shutterstockCategories: clip.metadata.shutterstockCategories,
        envatoCategory: clip.metadata.envatoCategory,
        recognizableBuildings: clip.metadata.recognizableBuildings,
        editorial: clip.editorial,
      }
    : null;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-t border-neutral-800 px-5 py-4">
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
    {children}
  </section>
);

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span
    className={clsx('tabular text-xs', value.length > max ? 'text-red-400' : 'text-neutral-500')}
  >
    {value.length}/{max}
  </span>
);

const inputClass =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-500';

interface Props {
  projectId: string;
  clip: ExportClip;
  video: SourceVideo | undefined;
  categories: StockCategories | undefined;
  platforms: StockPlatformInfo[] | undefined;
  onClose: () => void;
}

/** Side panel to review and edit one clip's context and metadata. */
export const ClipDrawer = ({ projectId, clip, video, categories, platforms, onClose }: Props) => {
  const [draft, setDraft] = useState<Draft | null>(() => draftOf(clip));
  const [hint, setHint] = useState('');
  const patch = usePatchMetadata(projectId);
  const approve = useApprove(projectId);
  const regenerate = useRegenerate(projectId);
  const retry = useRetryClip(projectId);
  const exclude = useExclude(projectId);

  // A new model answer (or another tab's edit) replaces the draft when nothing is being edited.
  const source = JSON.stringify(draftOf(clip));
  const [base, setBase] = useState(source);
  const dirty = draft !== null && JSON.stringify(draft) !== base;
  useEffect(() => {
    if (!dirty) {
      setDraft(draftOf(clip));
      setBase(source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async (): Promise<boolean> => {
    if (!draft || !dirty) return true;
    const body: ClipMetadataPatch = { ...draft };
    try {
      await patch.mutateAsync({ clipId: clip.id, patch: body });
      setBase(JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  };

  const onApprove = async () => {
    if (await save()) approve.mutate([clip.id]);
  };

  const busy = !['review', 'done', 'failed'].includes(clip.status);
  const geo = clip.context.geo;
  const tech = clip.context.tech;
  const place = [geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ');
  const error = patch.error ?? approve.error ?? regenerate.error ?? retry.error ?? exclude.error;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-full max-w-[720px] overflow-y-auto border-l border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-800 bg-neutral-950/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-100">
              #{clip.ordinal + 1} · {clip.originalFilename}
            </div>
            <div className="tabular text-xs text-neutral-500">
              {formatTimecode(clip.startSec)} – {formatTimecode(clip.endSec)} ·{' '}
              <span className={clipStatusTone(clip)}>{clipStatusLabel(clip)}</span>
              {clip.filename && <span> · {clip.filename}</span>}
            </div>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-neutral-800">
            Close
          </button>
        </header>

        {clip.status === 'failed' && (
          <div className="mx-5 mt-4 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
            <p className="mb-2 whitespace-pre-wrap break-words">
              Failed at “{clip.failedStep ?? 'unknown'}”: {clip.error}
            </p>
            <button
              onClick={() => retry.mutate(clip.id)}
              disabled={retry.isPending}
              className="rounded bg-red-800 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-40"
            >
              Retry step
            </button>
          </div>
        )}
        {error && <p className="mx-5 mt-3 text-sm text-red-400">{error.message}</p>}

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          {video?.proxyUrl && video.fps && video.durationSec ? (
            <SegmentPlayer
              src={video.proxyUrl}
              fps={video.fps}
              duration={video.durationSec}
              start={clip.startSec}
              end={clip.endSec}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded bg-neutral-900 text-xs text-neutral-500">
              no proxy
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(clip.context.frames ?? []).map((f) => (
              <a
                key={f.index}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                title={`Frame at ${f.timeSec.toFixed(2)} s`}
              >
                <img
                  src={f.url}
                  alt={`Frame ${f.index + 1}`}
                  className="aspect-video w-full rounded object-cover"
                />
              </a>
            ))}
            {!clip.context.frames?.length && (
              <p className="text-xs text-neutral-500">Frames not extracted yet.</p>
            )}
          </div>
        </div>

        <Section title="Location">
          {geo ? (
            <div className="space-y-2 text-sm">
              <p>
                {place || geo.manualText || 'Unknown'}
                <span className="ml-2 text-xs text-neutral-500">
                  {geo.source === 'embedded'
                    ? 'GPS from file'
                    : geo.source === 'manual'
                      ? 'manual'
                      : 'no location'}
                  {geo.localName && ` · ${geo.localName}`}
                </span>
              </p>
              {geo.poiCandidates.length > 0 && (
                <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
                  {geo.poiCandidates.map((p) => (
                    <li
                      key={`${p.nameEn}-${p.distanceM}`}
                      className="flex items-center gap-2 px-2 py-1 text-xs"
                    >
                      <span
                        className={clsx('flex-1', clip.poiOverride === p.nameEn && 'text-sky-300')}
                      >
                        {p.nameEn}
                        <span className="text-neutral-500">
                          {' '}
                          · {p.type} ·{' '}
                          {p.distanceM < 1000
                            ? `${p.distanceM} m`
                            : `${(p.distanceM / 1000).toFixed(1)} km`}{' '}
                          · {Math.round(p.bearingDeg)}°{p.inCameraSector === true && ' · in view'}
                        </span>
                      </span>
                      <button
                        disabled={busy || regenerate.isPending}
                        onClick={() =>
                          regenerate.mutate({
                            clipId: clip.id,
                            body: { poiName: p.nameEn, hint: hint || undefined },
                          })
                        }
                        className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700 disabled:opacity-40"
                        title="Regenerate the metadata with this landmark as the subject"
                      >
                        Use as subject
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Not determined yet.</p>
          )}
        </Section>

        {tech && (
          <Section title="Technical">
            <dl className="tabular grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-neutral-500">Shot</dt>
              <dd>{SHOT_LABEL[tech.shotType]}</dd>
              <dt className="text-neutral-500">Movement</dt>
              <dd>{tech.movement.join(', ')}</dd>
              <dt className="text-neutral-500">Format</dt>
              <dd>
                {tech.resolutionLabel} · {tech.width}×{tech.height} ·{' '}
                {tech.fps.toFixed(2).replace(/\.?0+$/, '')} fps
                {tech.outputFps !== tech.fps && ` → ${tech.outputFps} fps`}
              </dd>
              <dt className="text-neutral-500">Duration</dt>
              <dd>
                {formatDuration(tech.durationSec)}
                {clip.outputSizeBytes !== null && ` · ${formatBytes(clip.outputSizeBytes)}`}
              </dd>
              <dt className="text-neutral-500">Light</dt>
              <dd>
                {tech.timeOfDay ? TIME_LABEL[tech.timeOfDay] : '—'}
                {tech.season && ` · ${tech.season}`}
              </dd>
              <dt className="text-neutral-500">Date / camera</dt>
              <dd>
                {tech.captureDate ?? '—'}
                {tech.droneModel && ` · ${tech.droneModel}`}
              </dd>
              <dt className="text-neutral-500">Colour</dt>
              <dd>
                {tech.bitDepth}-bit · {tech.colorTransfer}
              </dd>
            </dl>
          </Section>
        )}

        <Section title="Metadata">
          {draft ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 flex justify-between text-xs text-neutral-400">
                  Title <Counter value={draft.title} max={70} />
                </span>
                <input
                  value={draft.title}
                  onChange={(e) => set('title', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 flex justify-between text-xs text-neutral-400">
                  Description <Counter value={draft.description} max={200} />
                </span>
                <textarea
                  value={draft.description}
                  rows={3}
                  onChange={(e) => set('description', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-neutral-400">
                  Subject (used in the file name)
                </span>
                <input
                  value={draft.subject}
                  onChange={(e) => set('subject', e.target.value)}
                  className={inputClass}
                />
              </label>
              <TagEditor value={draft.keywords} onChange={(k) => set('keywords', k)} />
              {categories && (
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-neutral-400">Adobe Stock category</span>
                    <select
                      value={draft.adobeCategory}
                      onChange={(e) => set('adobeCategory', Number(e.target.value))}
                      className={inputClass}
                    >
                      {categories.adobe.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id} · {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-neutral-400">Envato category</span>
                    <select
                      value={draft.envatoCategory}
                      onChange={(e) => set('envatoCategory', e.target.value)}
                      className={inputClass}
                    >
                      {categories.envato.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  {[0, 1].map((i) => (
                    <label key={i}>
                      <span className="mb-1 block text-neutral-400">
                        Shutterstock category {i + 1}
                        {i === 1 && ' (optional)'}
                      </span>
                      <select
                        value={draft.shutterstockCategories[i] ?? ''}
                        onChange={(e) => {
                          const next = [...draft.shutterstockCategories];
                          next[i] = e.target.value;
                          set(
                            'shutterstockCategories',
                            [...new Set(next.filter(Boolean))].slice(0, 2),
                          );
                        }}
                        className={inputClass}
                      >
                        {i === 1 && <option value="">—</option>}
                        {categories.shutterstock.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.editorial}
                    onChange={(e) => set('editorial', e.target.checked)}
                    className="accent-sky-500"
                  />
                  Editorial
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.recognizableBuildings}
                    onChange={(e) => set('recognizableBuildings', e.target.checked)}
                    className="accent-sky-500"
                  />
                  Recognizable buildings
                </label>
              </div>
              {clip.metadata?.editorialSuggested && (
                <p className="text-xs text-amber-300">
                  The model suggests editorial: {clip.metadata.editorialReason ?? 'no reason given'}
                </p>
              )}
              {clip.metadata && ['low', 'unknown'].includes(clip.metadata.placeConfidence) && (
                <p className="text-xs text-amber-300">
                  Place confidence: {clip.metadata.placeConfidence}. Check the location or give a
                  hint.
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void save()}
                  disabled={!dirty || patch.isPending || draft.keywords.length > KEYWORD_LIMIT}
                  className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40"
                >
                  {patch.isPending ? 'Saving…' : 'Save'}
                </button>
                {dirty && (
                  <button
                    onClick={() => setDraft(draftOf(clip))}
                    className="rounded px-3 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
                  >
                    Discard changes
                  </button>
                )}
                <span className="flex-1" />
                <PlatformBadges validations={clip.validations} platforms={platforms} />
              </div>
              {clip.validations.some((v) => v.messages.length) && (
                <ul className="space-y-0.5 text-xs text-neutral-400">
                  {clip.validations.flatMap((v) =>
                    v.messages.map((m) => (
                      <li key={`${v.platform}-${m}`}>
                        <span className={v.level === 'error' ? 'text-red-400' : 'text-amber-300'}>
                          {platforms?.find((p) => p.id === v.platform)?.label ?? v.platform}:
                        </span>{' '}
                        {m}
                      </li>
                    )),
                  )}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              {clip.status === 'llm' ? 'The model is writing the metadata…' : 'No metadata yet.'}
            </p>
          )}
        </Section>

        <Section title="Actions">
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Hint for the model, e.g. “this is Kazan Cathedral”"
                className={inputClass}
              />
              <button
                disabled={busy || regenerate.isPending || !clip.context.tech}
                onClick={() =>
                  regenerate.mutate({ clipId: clip.id, body: { hint: hint || undefined } })
                }
                className="shrink-0 rounded bg-violet-700 px-3 py-1 text-sm text-white hover:bg-violet-600 disabled:opacity-40"
              >
                Regenerate
              </button>
            </div>
            {clip.userHint && (
              <p className="text-xs text-neutral-500">Last hint: {clip.userHint}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {isAwaitingCut(clip) && (
                <span className="text-sm text-sky-300">Approved — waiting for encoding</span>
              )}
              {clip.status === 'review' && !clip.approved && (
                <button
                  onClick={() => void onApprove()}
                  disabled={approve.isPending || clip.excluded}
                  className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {dirty ? 'Save & approve' : 'Approve'}
                </button>
              )}
              <button
                onClick={() => exclude.mutate({ clipId: clip.id, excluded: !clip.excluded })}
                disabled={exclude.isPending}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40"
              >
                {clip.excluded ? 'Include in export' : 'Exclude from export'}
              </button>
              {clip.generation && (
                <span className="ml-auto text-xs text-neutral-500">
                  {clip.generation.model} · {clip.generation.promptVersion} · attempts:{' '}
                  {clip.generation.attempts}
                </span>
              )}
            </div>
          </div>
        </Section>
      </aside>
    </div>
  );
};
