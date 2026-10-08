import { decodeProtobuf, encodeProtobuf } from './protobuf.js';
import { parseDjiMeta } from './dji-telemetry.js';

const RAD = Math.PI / 180;

/** Synthetic packet shaped like DJI Mini 4 Pro djmd frame metadata (field 3.3.4 = GPS). */
const frame = (latDeg: number, lonDeg: number, altMm: number) =>
  encodeProtobuf([
    {
      field: 3,
      value: encodeProtobuf([
        { field: 1, value: encodeProtobuf([{ field: 2, value: 748_315_333 }]) },
        {
          field: 3,
          value: encodeProtobuf([
            {
              field: 4,
              value: encodeProtobuf([
                {
                  field: 1,
                  value: encodeProtobuf([
                    { field: 2, value: latDeg * RAD, wire: 'f64' },
                    { field: 3, value: lonDeg * RAD, wire: 'f64' },
                  ]),
                },
                { field: 2, value: altMm },
              ]),
            },
          ]),
        },
      ]),
    },
  ]);

const header = encodeProtobuf([
  {
    field: 1,
    value: encodeProtobuf([
      {
        field: 1,
        value: encodeProtobuf([
          { field: 1, value: 'dvtm_Mini4_Pro.proto' },
          { field: 10, value: 'DJI Mini4 Pro' },
        ]),
      },
    ]),
  },
]);

describe('protobuf', () => {
  it('decodes nested messages with paths', () => {
    const fields = decodeProtobuf(frame(48.8584, 2.2945, 35_000)) ?? [];
    expect(fields.find((f) => f.path === '3.3.4.2')?.value).toBe(35000n);
    expect(fields.find((f) => f.path === '3.3.4.1.2')?.type).toBe('f64');
  });

  it('rejects garbage', () => {
    expect(decodeProtobuf(Uint8Array.from([0x00, 0x01]))).toBeNull();
  });
});

describe('parseDjiMeta', () => {
  it('reads the schema name and a sampled GPS track in degrees', () => {
    const packets = [
      { t: 0, data: Uint8Array.from([...header, ...frame(48.8584, 2.2945, 35_000)]) },
      ...Array.from({ length: 30 }, (_, i) => ({
        t: (i + 1) / 10,
        data: frame(48.8584 + i * 0.00001, 2.2945, 35_000 + i * 100),
      })),
    ];
    const { schema, points } = parseDjiMeta(packets, { sampleEverySec: 1 });
    expect(schema).toBe('dvtm_Mini4_Pro.proto');
    expect(points.map((p) => p.t)).toEqual([0, 1, 2, 3]);
    expect(points[0]).toEqual({ t: 0, lat: 48.8584, lon: 2.2945, altitudeM: 35 });
  });

  it('ignores packets without a GPS fix', () => {
    const { points } = parseDjiMeta([
      { t: 0, data: frame(0, 0, 0) },
      { t: 1, data: frame(0, 0, 0) },
    ]);
    expect(points).toEqual([]);
  });
});
