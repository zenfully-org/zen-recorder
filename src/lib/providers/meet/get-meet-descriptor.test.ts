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
      meetingUrl: expect.any(Function),
    });
  });

  // The meeting notes name the meeting by its link, built from the code alone.
  it('links a meeting by its code, and nothing that is not one', () => {
    const { meetingUrl } = getMeetDescriptor();
    expect(meetingUrl('abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(meetingUrl('unknown')).toBeNull();
    expect(meetingUrl('abc-defg-hij/x')).toBeNull();
  });

  it('returns a fresh object each time', () => {
    expect(getMeetDescriptor()).not.toBe(getMeetDescriptor());
    expect(getMeetDescriptor().origins).not.toBe(getMeetDescriptor().origins);
  });
});
