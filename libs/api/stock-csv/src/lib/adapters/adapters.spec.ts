import { parse } from 'csv-parse/sync';
import { loadStockConfig } from '../config.js';
import { buildCsv } from '../csv.js';
import { slugify, transliterate } from '../text.js';
import { validationOf } from '../types.js';
import {
  ALL_CLIPS,
  ctx,
  editorialClip,
  oversizedClip,
  plainClip,
  trickyClip,
} from '../../test/fixtures.js';
import { createAdapters, envatoKeywords, pond5Sanitize, shutterstockDescription } from './index.js';

const stock = loadStockConfig();
const adapters = createAdapters(stock);
const byId = (id: string) => {
  const a = adapters.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
};

describe.each(adapters.map((a) => [a.id, a] as const))('%s CSV', (id, adapter) => {
  const file = buildCsv(adapter, ALL_CLIPS, ctx);

  it('matches the snapshot', async () => {
    await expect(file.content).toMatchFileSnapshot(`__snapshots__/${id}.csv`);
  });

  it('round-trips through a CSV parser with the exact header and one row per clip', () => {
    const rows = parse(file.content) as string[][];
    expect(rows[0]).toEqual([...adapter.header]);
    expect(rows).toHaveLength(ALL_CLIPS.length + 1);
    expect(rows.slice(1).map((r) => r[0])).toEqual(ALL_CLIPS.map((c) => c.filename));
  });

  it('reports limit violations instead of failing', () => {
    expect(validationOf(id, file.issues.get(plainClip.filename) ?? []).level).not.toBe('error');
    const over = validationOf(id, file.issues.get(oversizedClip.filename) ?? []);
    expect(over.level).not.toBe('ok');
    if (id !== 'pond5') expect(over.messages.join(' ')).toMatch(/maximum is \d+ s/);
  });
});

describe('file names', () => {
  it('Adobe CSV name has the author and date without spaces', () => {
    expect(byId('adobe').fileName(ctx)).toBe('adobe_stock_jane_doe_2024_08_02.csv');
    expect(byId('shutterstock').fileName(ctx)).toBe('shutterstock.csv');
  });
});

describe('keywords in comma-separated fields', () => {
  it('never lets a comma or quote inside a keyword split it', () => {
    const { row } = byId('adobe').toRow(trickyClip, ctx);
    expect(row[2]).toContain('old town square');
    expect(row[2]).not.toContain('"');
  });
});

describe('Adobe', () => {
  it('limits title to 70 characters and keywords to 50', () => {
    const { row, issues } = byId('adobe').toRow(oversizedClip, ctx);
    expect(row[1]?.length).toBeLessThanOrEqual(70);
    expect(row[2]?.split(', ')).toHaveLength(50);
    expect(issues.map((i) => i.message).join(' ')).toContain('Title shortened');
  });
});

describe('Shutterstock', () => {
  it('joins title and description when they fit in 200 characters', () => {
    expect(shutterstockDescription('Aerial view of a lake.', 'Drone flies over a lake.', 200)).toBe(
      'Aerial view of a lake. Drone flies over a lake.',
    );
    expect(shutterstockDescription('Title', 'x'.repeat(250), 200)).toBe('Title');
  });

  it('writes Yes/No editorial', () => {
    expect(byId('shutterstock').toRow(editorialClip, ctx).row[4]).toBe('Yes');
    expect(byId('shutterstock').toRow(plainClip, ctx).row[4]).toBe('No');
  });
});

describe('Pond5', () => {
  const forbidden = stock.pond5.forbiddenCharacters;

  it('transliterates diacritics and removes forbidden characters', () => {
    expect(pond5Sanitize('Café "Zum Löwen" (Zürich) & 50% @home / ß ñ å ø © ®', forbidden)).toBe(
      'Cafe Zum Lowen Zurich and 50 percent at home ss n a o',
    );
    expect(pond5Sanitize("Saint Isaac's Cathedral, Kazan (Russia)?", forbidden)).toBe(
      'Saint Isaacs Cathedral, Kazan Russia',
    );
  });

  it('formats editorial captions and mm/dd/yyyy dates', () => {
    const { row } = byId('pond5').toRow(editorialClip, ctx);
    expect(row[1]).toMatch(/^Saint Petersburg, Russia 2024\/07\/14: Aerial Tilt Up/);
    expect(row[2]).toMatch(/^Saint Petersburg, Russia 2024\/07\/14: Drone tilts up/);
    expect(row[13]).toBe('yes');
    expect(row[14]).toBe('07/14/2024');
  });

  it('falls back to the export date with a warning when the capture date is unknown', () => {
    const { row, issues } = byId('pond5').toRow(oversizedClip, ctx);
    expect(row[14]).toBe('08/02/2024');
    expect(issues.some((i) => i.message.includes('datecreated'))).toBe(true);
  });

  it('writes containsaudio = no even when the source has audio (clips are cut without it)', () => {
    const clip = { ...plainClip, tech: { ...plainClip.tech, hasAudio: true } };
    expect(byId('pond5').toRow(clip, ctx).row[8]).toBe('no');
  });
});

describe('Envato', () => {
  const rules = { max: 50, maxLength: 100, fieldMax: 2048, splitMultiword: false };

  it('keeps only allowed characters and drops digit-only / leading-dot tags', () => {
    expect(
      envatoKeywords(
        ['café', 'old town, square', '.hidden', '2024', 'church & tower', 'кафе', '4.5'],
        rules,
      ),
    ).toEqual(['cafe', 'old town square', 'hidden', 'church tower', 'kafe']);
  });

  it('splits multi-word tags with deduplication when configured', () => {
    expect(
      envatoKeywords(['wooden church', 'church', 'old wooden house'], {
        ...rules,
        splitMultiword: true,
      }),
    ).toEqual(['wooden', 'church', 'old', 'house']);
  });

  it('keeps the field under 2048 characters', () => {
    const long = Array.from({ length: 50 }, (_, i) => `${'k'.repeat(90)}${i}`);
    expect(envatoKeywords(long, rules).join(',').length).toBeLessThanOrEqual(2048);
  });

  it('maps pace, movement and prices', () => {
    const { row } = byId('envato').toRow(editorialClip, ctx);
    expect(row).toHaveLength(23);
    expect(row.slice(5, 16)).toEqual([
      '$19',
      '$39.50',
      'No',
      'Yes',
      '',
      '',
      'Full Color',
      'Slow Motion',
      'Aerial,Drone,Tilt Up',
      'Wide Shot',
      'Outdoors',
    ]);
  });
});

describe('text helpers', () => {
  it('transliterates and slugifies', () => {
    expect(transliterate('Кижи Погост, Zürich, Straße')).toBe('Kizhi Pogost, Zurich, Strasse');
    expect(slugify('Saint Isaac’s Cathedral — Санкт-Петербург')).toBe(
      'saint_isaac_s_cathedral_sankt_peterburg',
    );
  });
});

it('every adapter exposes verification info', () => {
  for (const a of adapters) expect(a.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(trickyClip.filename).toMatch(/^[a-z0-9_]+\.mov$/);
});
