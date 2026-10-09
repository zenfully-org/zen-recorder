import type { ProviderDescriptor } from '../types';
import { parseZoomMeetingId } from './parse-zoom-meeting-id';

/** A meeting in the web client by its number alone; the page's own link can carry a passcode. */
const meetingUrl = (meetingId: string): string | null =>
  parseZoomMeetingId(`/wc/${meetingId}`) === meetingId
    ? `https://app.zoom.us/wc/${meetingId}/join`
    : null;

/** Static facts about Zoom's web client (`app.zoom.us/wc/…` and account subdomains). */
export function getZoomDescriptor(): ProviderDescriptor {
  return {
    id: 'zoom',
    label: 'Zoom',
    origins: ['https://*.zoom.us/*'],
    fixturePrefix: '/zoom',
    fixtureHostname: 'app.zoom.us',
    meetingUrl,
  };
}
