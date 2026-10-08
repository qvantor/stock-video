import { useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KEYWORD_LIMIT } from './labels';

const Chip = ({ id, index, onRemove }: { id: string; index: number; onRemove: () => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-xs',
        index >= KEYWORD_LIMIT
          ? 'border-red-800 bg-red-950/50 text-red-300'
          : 'border-neutral-700 bg-neutral-800',
        isDragging && 'z-10 opacity-70',
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none"
        title="Drag to reorder"
      >
        {id}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${id}`}
        className="rounded-full px-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
      >
        ×
      </button>
    </li>
  );
};

/** Keyword chips: add with Enter/comma, remove, drag to reorder (most relevant first). */
export const TagEditor = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) => {
  const [input, setInput] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const add = (raw: string) => {
    const words = raw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const existing = new Set(value.map((v) => v.toLowerCase()));
    const fresh = words.filter((w) => !existing.has(w) && existing.add(w));
    if (fresh.length) onChange([...value, ...fresh]);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(arrayMove(value, value.indexOf(String(active.id)), value.indexOf(String(over.id))));
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-neutral-400">Keywords (most relevant first, drag to reorder)</span>
        <span
          className={clsx(
            'tabular',
            value.length > KEYWORD_LIMIT ? 'text-red-400' : 'text-neutral-400',
          )}
        >
          {value.length}/{KEYWORD_LIMIT}
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={value} strategy={horizontalListSortingStrategy}>
          <ul className="flex flex-wrap gap-1 rounded border border-neutral-700 bg-neutral-900 p-2">
            {value.map((k, i) => (
              <Chip
                key={k}
                id={k}
                index={i}
                onRemove={() => onChange(value.filter((v) => v !== k))}
              />
            ))}
            <li className="min-w-[120px] flex-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => input.trim() && add(input)}
                placeholder="add keyword…"
                className="w-full bg-transparent px-1 text-xs outline-none placeholder:text-neutral-600"
              />
            </li>
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
};
