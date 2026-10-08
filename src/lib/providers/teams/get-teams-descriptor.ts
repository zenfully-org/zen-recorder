import type { ProviderDescriptor } from '../types';

/** Static facts about Microsoft Teams on the web (work, personal and the new cloud domain). */
export function getTeamsDescriptor(): ProviderDescriptor {
  return {
    id: 'teams',
    label: 'Microsoft Teams',
    origins: [
      'https://teams.microsoft.com/*',
      'https://teams.live.com/*',
      'https://teams.cloud.microsoft/*',
    ],
    fixturePrefix: '/teams',
    fixtureHostname: 'teams.microsoft.com',
  };
}
