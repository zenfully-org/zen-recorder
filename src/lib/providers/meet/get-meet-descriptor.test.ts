import { describe, expect, it } from 'vitest';
import { getMeetDescriptor } from './get-meet-descriptor';

describe('getMeetDescriptor', () => {
  it('describes Google Meet', () => {
    expect(getMeetDescriptor()).toEqual({
      id: 'meet',
      label: 'Google Meet',
      origins: ['https://meet.google.com/*'],
      fixturePrefix: '',
      fixtureHostname: 'meet.google.com',
    });
  });

  it('returns a fresh object each time', () => {
    expect(getMeetDescriptor()).not.toBe(getMeetDescriptor());
    expect(getMeetDescriptor().origins).not.toBe(getMeetDescriptor().origins);
  });
});
