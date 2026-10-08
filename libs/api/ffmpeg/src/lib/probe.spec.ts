import { parseIso6709, parseProbeOutput } from './probe.js';

const djiProbe = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p10le',
      color_transfer: 'bt709',
      avg_frame_rate: '30000/1001',
      tags: { handler_name: 'VideoHandler' },
    },
    { codec_type: 'data', codec_name: 'none' },
  ],
  format: {
    duration: '65.2',
    tags: {
      creation_time: '2024-07-14T19:42:10.000000Z',
      encoder: 'DJI Mini4 Pro',
      location: '+59.9386+030.3141+120.500/',
    },
  },
};

describe('parseIso6709', () => {
  it('parses lat/lon with and without altitude', () => {
    expect(parseIso6709('+59.9386+030.3141+120.500/')).toEqual({
      lat: 59.9386,
      lon: 30.3141,
      altitudeM: 120.5,
    });
    expect(parseIso6709('-33.8568+151.2153/')).toEqual({
      lat: -33.8568,
      lon: 151.2153,
      altitudeM: null,
    });
  });

  it('rejects garbage and null island', () => {
    expect(parseIso6709('hello')).toBeNull();
    expect(parseIso6709('+00.0000+000.0000/')).toBeNull();
    expect(parseIso6709(undefined)).toBeNull();
  });
});

describe('parseProbeOutput', () => {
  it('extracts colour, GPS, camera and audio info', () => {
    const info = parseProbeOutput(djiProbe);
    expect(info).toMatchObject({
      width: 3840,
      height: 2160,
      codec: 'hevc',
      bitDepth: 10,
      colorTransfer: 'rec709',
      hasAudio: false,
      creationTime: '2024-07-14T19:42:10.000000Z',
      location: { lat: 59.9386, lon: 30.3141, altitudeM: 120.5 },
      make: 'DJI',
      model: 'DJI Mini4 Pro',
    });
    expect(info.fps).toBeCloseTo(29.97, 2);
  });

  it('detects log profiles from tags and HLG from the transfer', () => {
    const log = structuredClone(djiProbe);
    log.format.tags = { ...log.format.tags, comment: 'D-Log M' } as typeof log.format.tags;
    expect(parseProbeOutput(log).colorTransfer).toBe('log');
    const hlg = structuredClone(djiProbe);
    hlg.streams[0] = {
      ...hlg.streams[0],
      color_transfer: 'arib-std-b67',
    } as (typeof hlg.streams)[0];
    expect(parseProbeOutput(hlg).colorTransfer).toBe('hlg');
  });
});
