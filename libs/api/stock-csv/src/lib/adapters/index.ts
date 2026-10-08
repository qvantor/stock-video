import type { StockConfig } from '../config.js';
import type { StockCsvAdapter } from '../types.js';
import { adobeAdapter } from './adobe.js';
import { envatoAdapter } from './envato.js';
import { pond5Adapter } from './pond5.js';
import { shutterstockAdapter } from './shutterstock.js';

/**
 * Registered platforms. Adding a platform = one adapter file (+ its config/<id>.json) and one
 * line here; settings, validation badges, CSV export and the UI pick it up from this list.
 */
export const ADAPTER_FACTORIES: ((stock: StockConfig) => StockCsvAdapter)[] = [
  adobeAdapter,
  shutterstockAdapter,
  pond5Adapter,
  envatoAdapter,
];

export const createAdapters = (stock: StockConfig): StockCsvAdapter[] =>
  ADAPTER_FACTORIES.map((f) => f(stock));

export { adobeAdapter, envatoAdapter, pond5Adapter, shutterstockAdapter };
export { envatoKeywords } from './envato.js';
export { pond5Sanitize, editorialPrefix } from './pond5.js';
export { shutterstockDescription } from './shutterstock.js';
