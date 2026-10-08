import type { ProviderDescriptor } from '../types';

/** Static facts about Google Meet. Owns every fixture path no other provider claims. */
export function getMeetDescriptor(): ProviderDescriptor {
  return {
    id: 'meet',
    label: 'Google Meet',
    origins: ['https://meet.google.com/*'],
    fixturePrefix: '',
    fixtureHostname: 'meet.google.com',
  };
}
