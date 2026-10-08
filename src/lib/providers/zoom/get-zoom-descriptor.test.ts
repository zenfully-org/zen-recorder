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
    });
  });

  it('returns a fresh object each time', () => {
    expect(getZoomDescriptor()).not.toBe(getZoomDescriptor());
  });
});
