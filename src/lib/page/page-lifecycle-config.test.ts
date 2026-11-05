import { describe, expect, it } from 'vitest';
import { pageLifecycleConfig } from './page-lifecycle-config';

describe('pageLifecycleConfig', () => {
  it.each([
    { autoRecord: true, startRule: 'firstRemote' },
    { autoRecord: false, startRule: 'onJoin' },
  ] as const)(
    'takes auto-record $autoRecord and the $startRule rule from the settings',
    (config) => {
      expect(pageLifecycleConfig(config)).toMatchObject(config);
    },
  );

  it('stops after 5 s without a connection, and gives up after 3 encoder restarts within 60 s', () => {
    expect(pageLifecycleConfig({ autoRecord: true, startRule: 'firstRemote' })).toMatchObject({
      deadConnectionGraceMs: 5_000,
      maxEncoderRestarts: 3,
      encoderFailureWindowMs: 60_000,
    });
  });
});
