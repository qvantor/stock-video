import { DEFAULT_EXPORT_SETTINGS, type GeoContext, type TechContext } from '@dfs/contracts';
import type { CsvClip, CsvContext } from '../lib/types.js';

const tech = (over: Partial<TechContext> = {}): TechContext => ({
  durationSec: 20,
  sourceDurationSec: 20,
  fps: 29.97,
  outputFps: 29.97,
  width: 3840,
  height: 2160,
  resolutionLabel: '4K',
  codec: 'hevc',
  bitDepth: 10,
  colorTransfer: 'rec709',
  hasAudio: false,
  shotType: 'real_time',
  motionType: 'orbit_left',
  movement: ['Aerial', 'Drone', 'Arc'],
  timeOfDay: 'golden_hour',
  season: 'summer',
  capturedAt: '2024-07-14T18:30:00.000Z',
  captureDate: '2024-07-14',
  altitudeM: 120,
  droneModel: 'DJI Mini 4 Pro',
  ...over,
});

const geo = (over: Partial<GeoContext> = {}): GeoContext => ({
  source: 'embedded',
  lat: 61.7,
  lon: 35.2,
  altitudeM: 120,
  city: 'Kizhi',
  region: 'Republic of Karelia',
  country: 'Russia',
  countryCode: 'RU',
  displayName: 'Kizhi, Republic of Karelia, Russia',
  localName: 'Кижи',
  manualText: null,
  cameraHeadingDeg: null,
  poiCandidates: [],
  ...over,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `tag ${i + 1}`);

/** A typical clip. */
export const plainClip: CsvClip = {
  filename: 'wooden_church_kizhi_orbit_20240714_001.mov',
  metadata: {
    title: 'Aerial Orbit Around Kizhi Pogost Wooden Church, Lake Onega, Russia',
    description:
      'Drone orbits the wooden churches of Kizhi island on Lake Onega at golden hour in summer.',
    keywords: [
      'kizhi pogost',
      'wooden church',
      'russia',
      'lake onega',
      'aerial',
      'drone',
      'orbit',
      'summer',
      'golden hour',
    ],
    subject: 'wooden church',
    placeConfidence: 'high',
    adobeCategory: 2,
    shutterstockCategories: ['Buildings/Landmarks', 'Religion'],
    envatoCategory: 'Buildings',
    recognizableBuildings: true,
    editorialSuggested: false,
    editorialReason: null,
  },
  editorial: false,
  geo: geo(),
  tech: tech(),
  outputSizeBytes: 250_000_000,
};

/** Quotes, commas, diacritics and Cyrillic inside fields. */
export const trickyClip: CsvClip = {
  filename: 'cafe_square_zurich_pan_right_20240301_002.mov',
  metadata: {
    title: 'Café "Zum Löwen", Old Town Square, Zürich – Aerial Pan',
    description:
      "Drone pans over the café's terrace, the Fraumünster (church) & 50% of the old town, Zürich; early spring.",
    keywords: [
      'café',
      'zürich',
      'old town, square',
      'fraumünster',
      'church & tower',
      '"quoted"',
      'кафе',
      'spring',
      'aerial',
      'drone',
      '.hidden',
      '2024',
    ],
    subject: 'cafe square',
    placeConfidence: 'medium',
    adobeCategory: 21,
    shutterstockCategories: ['Buildings/Landmarks'],
    envatoCategory: 'City',
    recognizableBuildings: true,
    editorialSuggested: false,
    editorialReason: null,
  },
  editorial: false,
  geo: geo({
    city: 'Zürich',
    region: 'Zürich',
    country: 'Switzerland',
    countryCode: 'CH',
    localName: 'Zürich',
  }),
  tech: tech({
    captureDate: '2024-03-01',
    motionType: 'pan_right',
    movement: ['Aerial', 'Drone', 'Tracking Right'],
    droneModel: 'DJI Air 3',
  }),
  outputSizeBytes: 120_000_000,
};

/** Over every limit: long title/description, 60 keywords, too long, too big. */
export const oversizedClip: CsvClip = {
  filename: 'river_valley_unknown_forward_20240714_003.mov',
  metadata: {
    title:
      'Aerial Flight Forward Over a Winding River Valley With Dense Pine Forest and Rocky Cliffs Under Clouds',
    description:
      'Drone flies forward low over a winding river through a valley with dense pine forest, rocky cliffs and scattered meadows under a cloudy summer sky, revealing the mountains on the horizon in the distance.',
    keywords: words(60),
    subject: 'river valley',
    placeConfidence: 'unknown',
    adobeCategory: 11,
    shutterstockCategories: ['Nature', 'Transportation'],
    envatoCategory: 'Nature',
    recognizableBuildings: false,
    editorialSuggested: false,
    editorialReason: null,
  },
  editorial: false,
  geo: null,
  tech: tech({
    durationSec: 75,
    sourceDurationSec: 75,
    captureDate: null,
    motionType: 'forward',
    movement: ['Aerial', 'Drone'],
    droneModel: null,
  }),
  outputSizeBytes: 6 * 1024 ** 3,
};

/** Editorial clip: famous architecture, slow motion. */
export const editorialClip: CsvClip = {
  filename: 'cathedral_saint_petersburg_tilt_up_20240714_004.mov',
  metadata: {
    title: "Aerial Tilt Up Reveal of Saint Isaac's Cathedral, Saint Petersburg",
    description: "Drone tilts up to reveal the golden dome of Saint Isaac's Cathedral in summer.",
    keywords: [
      "saint isaac's cathedral",
      'saint petersburg',
      'russia',
      'dome',
      'aerial',
      'drone',
      'slow motion',
    ],
    subject: 'cathedral',
    placeConfidence: 'high',
    adobeCategory: 15,
    shutterstockCategories: ['Buildings/Landmarks'],
    envatoCategory: 'Buildings',
    recognizableBuildings: true,
    editorialSuggested: true,
    editorialReason: 'Famous protected landmark',
  },
  editorial: true,
  geo: geo({ city: 'Saint Petersburg', region: 'Saint Petersburg', country: 'Russia' }),
  tech: tech({
    shotType: 'slow_motion',
    durationSec: 40,
    outputFps: 30,
    motionType: 'tilt_up',
    movement: ['Aerial', 'Drone', 'Tilt Up'],
  }),
  outputSizeBytes: 400_000_000,
};

export const ALL_CLIPS = [plainClip, trickyClip, oversizedClip, editorialClip];

export const ctx: CsvContext = {
  settings: {
    ...DEFAULT_EXPORT_SETTINGS,
    adobeAuthor: 'Jane Doe',
    copyright: '© Jane Doe 2024',
    pond5Price: 79,
    pond5PriceLarge: 149,
    envatoPriceSingle: 19,
    envatoPriceMulti: 39.5,
  },
  exportDate: new Date(2024, 7, 2, 10, 30),
};
