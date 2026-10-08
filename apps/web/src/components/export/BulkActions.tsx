import { useState } from 'react';
import type { ExportClip } from '@dfs/contracts';
import { useApprove, useBulkKeywords } from '../../api/export';

const input =
  'w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-sky-500';

/** Group actions on the selected clips (or all reviewed ones). */
export const BulkActions = ({
  projectId,
  clips,
  selected,
}: {
  projectId: string;
  clips: ExportClip[];
  selected: Set<string>;
}) => {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [tag, setTag] = useState('');
  const keywords = useBulkKeywords(projectId);
  const approve = useApprove(projectId);
  const withMetadata = clips.filter((c) => c.metadata && !c.excluded);
  const targets = (
    selected.size ? withMetadata.filter((c) => selected.has(c.id)) : withMetadata
  ).map((c) => c.id);
  const reviewable = clips
    .filter((c) => c.status === 'review' && !c.approved && !c.excluded)
    .map((c) => c.id);
  const scope = selected.size ? `${targets.length} selected` : `all ${targets.length}`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs">
      <button
        disabled={!reviewable.length || approve.isPending}
        onClick={() => approve.mutate(reviewable)}
        className="rounded bg-emerald-700 px-3 py-1 font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
      >
        Approve all ({reviewable.length})
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-800" />
      <span className="text-neutral-500">Tags of {scope}:</span>
      <input
        value={find}
        onChange={(e) => setFind(e.target.value)}
        placeholder="find tag"
        className={input}
      />
      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="replace with (empty = remove)"
        className={input}
      />
      <button
        disabled={!find.trim() || !targets.length || keywords.isPending}
        onClick={() => keywords.mutate({ op: 'replace', clipIds: targets, find, replace })}
        className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
      >
        Replace
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-800" />
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder="tag"
        className={input}
      />
      <button
        disabled={!tag.trim() || !targets.length || keywords.isPending}
        onClick={() =>
          keywords.mutate(
            { op: 'add', clipIds: targets, keyword: tag },
            { onSuccess: () => setTag('') },
          )
        }
        className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
      >
        Add
      </button>
      <button
        disabled={!tag.trim() || !targets.length || keywords.isPending}
        onClick={() =>
          keywords.mutate(
            { op: 'remove', clipIds: targets, keyword: tag },
            { onSuccess: () => setTag('') },
          )
        }
        className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
      >
        Remove
      </button>
      {(keywords.error ?? approve.error) && (
        <span className="text-red-400">{(keywords.error ?? approve.error)?.message}</span>
      )}
    </div>
  );
};
