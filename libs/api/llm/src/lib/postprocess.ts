import type { ClipMetadata } from '@dfs/contracts';
import { collapse, truncateAtWord, truncateText } from '@dfs/stock-csv';
import type { LlmLimits } from './schema.js';

export interface PostprocessRules {
  technicalTerms: string[];
  brandNames: string[];
  fillerWords: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const removeWords = (text: string, words: string[]): string =>
  words.length
    ? collapse(text.replace(new RegExp(`\\b(${words.map(escapeRe).join('|')})\\b\\s*`, 'gi'), ''))
    : text;

/** Simple English singular for duplicate detection ("churches" ~ "church", "cities" ~ "city"). */
const singular = (word: string): string => {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
};

const normKey = (keyword: string): string => {
  const parts = keyword.split(' ');
  parts[parts.length - 1] = singular(parts[parts.length - 1] ?? '');
  return parts.join(' ');
};

/** Lowercase, strip odd characters, drop technical terms and brands, dedupe (incl. plurals). */
export const cleanKeywords = (
  keywords: string[],
  rules: PostprocessRules,
  max: number,
): string[] => {
  const banned = new Set(
    [...rules.technicalTerms, ...rules.brandNames].map((w) => w.toLowerCase()),
  );
  const bannedWord = new RegExp(
    `\\b(${[...rules.brandNames].map(escapeRe).join('|') || '(?!)'})\\b`,
    'i',
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = collapse(
      raw
        .toLowerCase()
        .normalize('NFC')
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/^[-'\s]+|[-'\s]+$/g, ''),
    );
    if (!k || banned.has(k) || bannedWord.test(k)) continue;
    if (/^\d+(\.\d+)?\s*(k|p|fps|mbps|bit)$/.test(k)) continue;
    if (/^\d+$/.test(k)) continue;
    const key = normKey(k);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
};

/** Post-process the model answer: limits, filler words, keyword hygiene. */
export const postprocessMetadata = (
  m: ClipMetadata,
  limits: LlmLimits,
  rules: PostprocessRules,
): ClipMetadata => {
  const title = truncateAtWord(removeWords(m.title, rules.fillerWords), limits.titleMax);
  const description = truncateText(
    removeWords(m.description, rules.fillerWords),
    limits.descriptionMax,
  );
  const subject = collapse(m.subject).split(' ').slice(0, 5).join(' ');
  return {
    ...m,
    title,
    description,
    subject,
    keywords: cleanKeywords(m.keywords, rules, limits.keywordsMax),
    shutterstockCategories: [...new Set(m.shutterstockCategories)].slice(0, 2),
    editorialReason: m.editorialSuggested ? m.editorialReason?.trim() || null : null,
  };
};
