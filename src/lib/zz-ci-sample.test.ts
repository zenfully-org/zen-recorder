import { zzCiSample } from './zz-ci-sample';

describe('zzCiSample', () => {
  it('returns two for anything but x', () => {
    expect(zzCiSample('y')).toBe(2);
  });
});
