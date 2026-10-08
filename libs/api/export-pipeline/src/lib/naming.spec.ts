import {
  assignFilenames,
  MAX_FILENAME_LENGTH,
  renderFilename,
  type NamingInput,
} from './naming.js';

const clip = (over: Partial<NamingInput> = {}): NamingInput => ({
  id: 'c1',
  ordinal: 0,
  motionType: 'orbit_left',
  metadata: { subject: 'Wooden Church' },
  geo: { city: 'Kizhi', region: 'Karelia', country: 'Russia' },
  tech: { captureDate: '2024-07-14' },
  ...over,
});
const TEMPLATE = '{subject}_{place}_{motion}_{date}_{n}';

describe('renderFilename', () => {
  it('follows the template with [a-z0-9_] only', () => {
    expect(renderFilename(TEMPLATE, clip(), 'mov')).toBe(
      'wooden_church_kizhi_orbit_20240714_001.mov',
    );
  });

  it('transliterates diacritics and Cyrillic, removes hyphens and spaces', () => {
    const name = renderFilename(
      TEMPLATE,
      clip({
        metadata: { subject: 'Café-Terrasse Église' },
        geo: { city: 'Санкт-Петербург', region: null, country: null },
      }),
      'mov',
    );
    expect(name).toBe('cafe_terrasse_eglise_sankt_peterburg_orbit_20240714_001.mov');
    expect(name).toMatch(/^[a-z0-9_]+\.mov$/);
  });

  it('skips missing parts without double underscores', () => {
    expect(renderFilename(TEMPLATE, clip({ geo: null, tech: null, metadata: null }), 'mp4')).toBe(
      'aerial_orbit_001.mp4',
    );
  });

  it('never exceeds 80 characters and keeps the motion/date/number', () => {
    const name = renderFilename(
      TEMPLATE,
      clip({
        metadata: { subject: 'very long subject description with many many words in it' },
        geo: {
          city: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch',
          region: null,
          country: null,
        },
      }),
      'mov',
    );
    expect(name.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(name).toMatch(/_orbit_20240714_001\.mov$/);
  });
});

describe('assignFilenames', () => {
  it('guarantees uniqueness even when the template has no number', () => {
    const names = assignFilenames(
      [clip({ id: 'a', ordinal: 0 }), clip({ id: 'b', ordinal: 1 }), clip({ id: 'c', ordinal: 2 })],
      '{subject}_{place}',
      'mov',
    );
    expect([...names.values()]).toEqual([
      'wooden_church_kizhi.mov',
      'wooden_church_kizhi_2.mov',
      'wooden_church_kizhi_3.mov',
    ]);
  });
});
