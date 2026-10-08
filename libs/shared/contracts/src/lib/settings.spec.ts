import { AnalysisSettingsSchema, DEFAULT_ANALYSIS_SETTINGS } from './settings.js';

describe('AnalysisSettingsSchema', () => {
  it('accepts defaults', () => {
    expect(AnalysisSettingsSchema.parse(DEFAULT_ANALYSIS_SETTINGS)).toEqual(
      DEFAULT_ANALYSIS_SETTINGS,
    );
  });

  it('rejects min >= max and target outside range', () => {
    expect(
      AnalysisSettingsSchema.safeParse({
        ...DEFAULT_ANALYSIS_SETTINGS,
        minDuration: 60,
      }).success,
    ).toBe(false);
    expect(
      AnalysisSettingsSchema.safeParse({
        ...DEFAULT_ANALYSIS_SETTINGS,
        targetDuration: 5,
      }).success,
    ).toBe(false);
  });
});
