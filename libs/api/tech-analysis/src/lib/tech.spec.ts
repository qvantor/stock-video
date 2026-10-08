import { analyzeTech, type TechMediaInput } from './tech.js';
import { detectShotType, outputDuration } from './shot-type.js';
import { mapMovement } from './movement.js';
import { resolutionLabel } from './resolution.js';
import {
  filenameWallClock,
  resolveCaptureTime,
  seasonOf,
  timeOfDay,
  tzOffsetMinutes,
} from './time.js';

const base = {
  fps: 29.97,
  conformFps: null,
  durationSec: 20,
  originalFilename: 'DJI_0042.MP4',
  tags: {},
  motionType: 'forward' as const,
};

describe('detectShotType', () => {
  it('real time by default', () => {
    expect(detectShotType(base)).toBe('real_time');
  });

  it('timelapse / hyperlapse from the file name or metadata', () => {
    expect(detectShotType({ ...base, originalFilename: 'HYPERLAPSE_0003.MP4' })).toBe('hyperlapse');
    expect(
      detectShotType({ ...base, originalFilename: 'DJI_TL_0004.MP4', motionType: 'static' }),
    ).toBe('timelapse');
    expect(detectShotType({ ...base, tags: { comment: 'Timelapse' }, motionType: 'static' })).toBe(
      'timelapse',
    );
  });

  it('timelapse when real elapsed time is much longer than the video time (threshold ×1.5)', () => {
    expect(detectShotType({ ...base, realElapsedSec: 29, motionType: 'static' })).toBe('real_time');
    expect(detectShotType({ ...base, realElapsedSec: 31, motionType: 'static' })).toBe('timelapse');
    expect(detectShotType({ ...base, realElapsedSec: 600 })).toBe('hyperlapse');
    expect(
      detectShotType(
        { ...base, realElapsedSec: 25, motionType: 'static' },
        { timelapseRatio: 1.2, highFrameRateFps: 100 },
      ),
    ).toBe('timelapse');
  });

  it('slow motion only for ≥100 fps with conform enabled, otherwise high frame rate', () => {
    expect(detectShotType({ ...base, fps: 119.88 })).toBe('high_frame_rate');
    expect(detectShotType({ ...base, fps: 119.88, conformFps: 30 })).toBe('slow_motion');
    expect(detectShotType({ ...base, fps: 59.94, conformFps: 30 })).toBe('real_time');
  });

  it('conformed duration grows by the frame-rate ratio', () => {
    expect(outputDuration(10, 120, 'slow_motion', 30)).toBe(40);
    expect(outputDuration(10, 120, 'high_frame_rate', null)).toBe(10);
  });
});

describe('mapMovement', () => {
  it('maps stage-1 motion to Envato movement terms', () => {
    expect(mapMovement('orbit_left')).toEqual(['Aerial', 'Drone', 'Arc']);
    expect(mapMovement('pan_right')).toEqual(['Aerial', 'Drone', 'Tracking Right']);
    expect(mapMovement('tilt_down')).toEqual(['Aerial', 'Drone', 'Tilt Down']);
    expect(mapMovement('forward')).toEqual(['Aerial', 'Drone']);
    expect(mapMovement('static', { topDown: true })).toEqual(['Aerial', 'Drone', 'Top Down']);
  });
});

describe('resolutionLabel', () => {
  it.each([
    [3840, 2160, '4K'],
    [4096, 2160, '4K'],
    [2720, 1530, '2.7K'],
    [1920, 1080, 'HD'],
    [1080, 1920, 'HD'],
    [5472, 3078, '5K'],
    [640, 360, 'SD'],
  ])('%ix%i → %s', (w, h, label) => expect(resolutionLabel(w, h)).toBe(label));
});

describe('time of day and season', () => {
  // St Petersburg, 59.94N 30.31E
  const spb = { lat: 59.9386, lon: 30.3141 };

  it('classifies sun altitude', () => {
    expect(timeOfDay(new Date('2024-07-14T09:00:00Z'), spb.lat, spb.lon)).toBe('day');
    expect(timeOfDay(new Date('2024-01-14T22:00:00Z'), spb.lat, spb.lon)).toBe('night');
    // Sydney sunset in mid-January is ~09:10 UTC.
    expect(timeOfDay(new Date('2024-01-15T09:05:00Z'), -33.86, 151.21)).toBe('sunset');
    // Sydney sunrise in mid-January is ~18:55 UTC (previous day).
    expect(timeOfDay(new Date('2024-01-14T19:00:00Z'), -33.86, 151.21)).toBe('sunrise');
    expect(timeOfDay(new Date('2024-01-15T08:45:00Z'), -33.86, 151.21)).toBe('golden_hour');
    expect(timeOfDay(new Date('2024-01-15T09:30:00Z'), -33.86, 151.21)).toBe('blue_hour');
  });

  it('flips seasons in the southern hemisphere', () => {
    expect(seasonOf(7, spb.lat)).toBe('summer');
    expect(seasonOf(7, -33.86)).toBe('winter');
    expect(seasonOf(1, 10)).toBe('winter');
    expect(seasonOf(10, -40)).toBe('spring');
    expect(seasonOf(4, 50)).toBe('spring');
  });
});

describe('resolveCaptureTime', () => {
  it('treats DJI timestamps as local wall-clock time at the GPS position', () => {
    const r = resolveCaptureTime({
      creationTime: '2024-07-14T21:30:00.000000Z',
      mode: 'auto',
      make: 'DJI',
      lat: 59.9386,
      lon: 30.3141,
    });
    expect(r.utc?.toISOString()).toBe('2024-07-14T18:30:00.000Z'); // Moscow time = UTC+3
    expect(r.localDate).toBe('2024-07-14');
  });

  it('treats other cameras as UTC and converts the local date', () => {
    const r = resolveCaptureTime({
      creationTime: '2024-07-14T22:30:00Z',
      mode: 'auto',
      make: 'Apple',
      lat: 59.9386,
      lon: 30.3141,
    });
    expect(r.utc?.toISOString()).toBe('2024-07-14T22:30:00.000Z');
    expect(r.localDate).toBe('2024-07-15');
  });

  it('prefers the local time in the file name (DJI Fly export, Andorra in summer = UTC+2)', () => {
    const r = resolveCaptureTime({
      creationTime: '2026-08-11T11:35:58.000000Z',
      mode: 'auto',
      make: 'DJI',
      lat: 42.57,
      lon: 1.59,
      filename: 'dji_fly_20260811_133558_0581_1786616590967_video.mp4',
    });
    expect(r.utc?.toISOString()).toBe('2026-08-11T11:35:58.000Z');
    expect(r.localDate).toBe('2026-08-11');
    expect(filenameWallClock('DJI_20240714213000_0001_D.MP4')).toBe(
      Date.UTC(2024, 6, 14, 21, 30, 0),
    );
    expect(filenameWallClock('DJI_0042.MP4')).toBeNull();
  });

  it('ignores unset camera clocks', () => {
    expect(
      resolveCaptureTime({
        creationTime: '1970-01-01T00:00:00Z',
        mode: 'auto',
        make: null,
        lat: null,
        lon: null,
      }).utc,
    ).toBeNull();
  });

  it('computes DST-aware offsets', () => {
    expect(tzOffsetMinutes(new Date('2024-07-01T12:00:00Z'), 'Europe/Berlin')).toBe(120);
    expect(tzOffsetMinutes(new Date('2024-01-01T12:00:00Z'), 'Europe/Berlin')).toBe(60);
  });
});

describe('analyzeTech', () => {
  const media: TechMediaInput = {
    fps: 119.88,
    width: 3840,
    height: 2160,
    codec: 'hevc',
    bitDepth: 10,
    colorTransfer: 'log',
    hasAudio: false,
    creationTime: '2024-07-14T21:30:00Z',
    make: 'DJI',
    model: 'DJI Air 3',
    tags: {},
  };

  it('combines all features', () => {
    const t = analyzeTech({
      media,
      originalFilename: 'DJI_0042.MP4',
      startSec: 10,
      endSec: 20,
      motionType: 'orbit_right',
      lat: 59.9386,
      lon: 30.3141,
      altitudeM: 120,
      slowMoConform: '30',
      creationTimeMode: 'auto',
    });
    expect(t).toMatchObject({
      shotType: 'slow_motion',
      outputFps: 30,
      resolutionLabel: '4K',
      season: 'summer',
      movement: ['Aerial', 'Drone', 'Arc'],
      captureDate: '2024-07-14',
      capturedAt: '2024-07-14T18:30:10.000Z',
      droneModel: 'DJI Air 3',
    });
    expect(t.durationSec).toBeCloseTo(39.96, 2);
  });

  it('leaves time of day and season empty without a position', () => {
    const t = analyzeTech({
      media: { ...media, fps: 30 },
      originalFilename: 'x.mp4',
      startSec: 0,
      endSec: 10,
      motionType: 'forward',
      lat: null,
      lon: null,
      altitudeM: null,
      slowMoConform: 'off',
      creationTimeMode: 'auto',
    });
    expect(t).toMatchObject({
      shotType: 'real_time',
      timeOfDay: null,
      season: null,
      captureDate: '2024-07-14',
    });
  });
});
