import { DEFAULT_EXPORT_SETTINGS, ExportSettingsSchema } from './export-settings.js';
import { ClipMetadataPatchSchema } from './clip.js';

describe('ExportSettingsSchema', () => {
  it('fills every field from an empty object', () => {
    expect(DEFAULT_EXPORT_SETTINGS).toMatchObject({
      model: 'gemma4:31b',
      think: false,
      autoApprove: false,
      slowMoConform: 'off',
      poiRadiusM: 2000,
      encoding: { codec: 'h264', container: 'mov' },
    });
  });

  it('keeps stored values and fills new fields (forward compatible)', () => {
    const parsed = ExportSettingsSchema.parse({ model: 'other', encoding: { codec: 'prores_hq' } });
    expect(parsed.model).toBe('other');
    expect(parsed.encoding).toEqual({ ...DEFAULT_EXPORT_SETTINGS.encoding, codec: 'prores_hq' });
    expect(parsed.enabledPlatforms).toEqual(DEFAULT_EXPORT_SETTINGS.enabledPlatforms);
  });

  it('rejects invalid values', () => {
    expect(ExportSettingsSchema.safeParse({ slowMoConform: '24' }).success).toBe(false);
    expect(ExportSettingsSchema.safeParse({ ollamaUrl: 'not a url' }).success).toBe(false);
  });
});

describe('ClipMetadataPatchSchema', () => {
  it('accepts partial patches and trims', () => {
    expect(ClipMetadataPatchSchema.parse({ title: '  Aerial view  ' })).toEqual({
      title: 'Aerial view',
    });
    expect(ClipMetadataPatchSchema.safeParse({ shutterstockCategories: [] }).success).toBe(false);
  });
});
