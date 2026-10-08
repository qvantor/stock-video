import { makeClip, makeProject, makeSegment, makeVideo } from './utils';
import { ExportClipSchema, ProjectSchema, SegmentSchema, SourceVideoSchema } from '@dfs/contracts';

describe('test factories', () => {
  it('produce contract-valid objects', () => {
    expect(() => ProjectSchema.parse(makeProject())).not.toThrow();
    expect(() => SourceVideoSchema.parse(makeVideo())).not.toThrow();
    expect(() => SegmentSchema.parse(makeSegment())).not.toThrow();
    expect(() => ExportClipSchema.parse(makeClip())).not.toThrow();
  });
});
