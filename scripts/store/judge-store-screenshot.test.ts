// @vitest-environment node
import { judgeStoreScreenshot } from './judge-store-screenshot';

describe('judgeStoreScreenshot', () => {
  it('passes a picture of AMO’s display size under 100 kB', () => {
    expect(judgeStoreScreenshot({ width: 1280, height: 800, bytes: 99_999 })).toEqual([]);
  });

  it('names every way a picture misses the listing’s limits', () => {
    expect(judgeStoreScreenshot({ width: 1366, height: 768, bytes: 100_000 })).toEqual([
      'is 1366 by 768 pixels, not 1280 by 800',
      'weighs 100000 bytes, not under 100 kB',
    ]);
  });
});
