import { describe, expect, it } from 'vitest';
import { toMeetingLocation } from './to-meeting-location';
import type { ProviderDescriptor } from './types';

const zoom: ProviderDescriptor = {
  id: 'zoom',
  label: 'Zoom',
  origins: ['https://app.zoom.us/*'],
  fixturePrefix: '/zoom',
  fixtureHostname: 'app.zoom.us',
  meetingUrl: () => null,
};
const meet: ProviderDescriptor = {
  id: 'meet',
  label: 'Google Meet',
  origins: ['https://meet.google.com/*'],
  fixturePrefix: '',
  fixtureHostname: 'meet.google.com',
  meetingUrl: () => null,
};

describe('toMeetingLocation', () => {
  it('copies a real location as it is', () => {
    const location = {
      hostname: 'app.zoom.us',
      pathname: '/wc/123/join',
      search: '?a=1',
      hash: '#x',
    };
    expect(toMeetingLocation(location, zoom)).toEqual(location);
  });

  it('copies only the fields a provider reads', () => {
    const location = {
      hostname: 'meet.google.com',
      pathname: '/abc-defg-hij',
      search: '',
      hash: '',
      origin: 'https://meet.google.com',
    };
    expect(toMeetingLocation(location, meet)).toEqual({
      hostname: 'meet.google.com',
      pathname: '/abc-defg-hij',
      search: '',
      hash: '',
    });
  });

  it('makes a fixture URL look like the real service', () => {
    const location = {
      hostname: 'localhost',
      pathname: '/zoom/wc/123/join',
      search: '?p=1',
      hash: '',
    };
    expect(toMeetingLocation(location, zoom)).toEqual({
      hostname: 'app.zoom.us',
      pathname: '/wc/123/join',
      search: '?p=1',
      hash: '',
    });
  });

  it('keeps a root path when only the prefix is present', () => {
    const location = { hostname: '127.0.0.1', pathname: '/zoom', search: '', hash: '' };
    expect(toMeetingLocation(location, zoom).pathname).toBe('/');
  });

  it('leaves fixture paths of the prefix-less provider untouched', () => {
    const location = { hostname: 'localhost', pathname: '/abc-defg-hij', search: '', hash: '' };
    expect(toMeetingLocation(location, meet)).toEqual({
      hostname: 'meet.google.com',
      pathname: '/abc-defg-hij',
      search: '',
      hash: '',
    });
  });

  it('does not strip a prefix that only looks similar', () => {
    const location = { hostname: 'localhost', pathname: '/zoomies/1', search: '', hash: '' };
    expect(toMeetingLocation(location, zoom).pathname).toBe('/zoomies/1');
  });
});
