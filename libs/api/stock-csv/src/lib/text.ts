const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cut to `max` characters at a word boundary, without dangling punctuation. */
export const truncateAtWord = (text: string, max: number): string => {
  const t = collapse(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : t.slice(0, max);
  return base.replace(/[\s,;:\-–—(]+$/u, '');
};

/** Prefer ending on a full sentence when the text is too long. */
export const truncateText = (text: string, max: number): string => {
  const t = collapse(text);
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
    head.endsWith('.') ? max - 1 : -1,
  );
  return end > max * 0.5 ? head.slice(0, end + 1) : truncateAtWord(t, max);
};

const SPECIAL: Record<string, string> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
};

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
};

/** ASCII transliteration: diacritics (é → e, ß → ss) and Cyrillic (Кижи → Kizhi). */
export const transliterate = (text: string): string =>
  text
    .replace(/[\u0080-\u{10FFFF}]/gu, (ch) => {
      if (SPECIAL[ch] !== undefined) return SPECIAL[ch];
      const lower = ch.toLowerCase();
      const cyr = CYRILLIC[lower];
      if (cyr !== undefined) return ch === lower ? cyr : cyr.charAt(0).toUpperCase() + cyr.slice(1);
      return ch;
    })
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...');

/** Lowercase ASCII slug of [a-z0-9_]. */
export const slugify = (text: string): string =>
  transliterate(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export { collapse };
