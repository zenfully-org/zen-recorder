import { describe, expect, it } from 'vitest';
import { getZoomDescriptor } from './get-zoom-descriptor';

describe('getZoomDescriptor', () => {
  it('describes the Zoom web client', () => {
    expect(getZoomDescriptor()).toEqual({
      id: 'zoom',
      label: 'Zoom',
      origins: ['https://*.zoom.us/*'],
      fixturePrefix: '/zoom',
      fixtureHostname: 'app.zoom.us',
      meetingUrl: expect.any(Function),
    });
  });

  // From the number alone: the page's own link can carry a passcode (`pwd`) or the user's name.
  it('links a meeting by its number in the web client, and nothing that is not one', () => {
    const { meetingUrl } = getZoomDescriptor();
    expect(meetingUrl('123456789')).toBe('https://app.zoom.us/wc/123456789/join');
    expect(meetingUrl('unknown')).toBeNull();
  });

  it('returns a fresh object each time', () => {
    expect(getZoomDescriptor()).not.toBe(getZoomDescriptor());
  });
});
