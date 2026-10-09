import type { ProviderDescriptor } from '../types';
import { parseMeetingCode } from './parse-meeting-code';

/** Meet's link is its code: `https://meet.google.com/abc-defg-hij`. */
const meetingUrl = (meetingId: string): string | null =>
  parseMeetingCode(`/${meetingId}`) === meetingId ? `https://meet.google.com/${meetingId}` : null;

/** Static facts about Google Meet. Owns every fixture path no other provider claims. */
export function getMeetDescriptor(): ProviderDescriptor {
  return {
    id: 'meet',
    label: 'Google Meet',
    origins: ['https://meet.google.com/*'],
    fixturePrefix: '',
    fixtureHostname: 'meet.google.com',
    meetingUrl,
  };
}
