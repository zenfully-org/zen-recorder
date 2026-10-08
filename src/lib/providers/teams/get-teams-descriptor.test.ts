import { describe, expect, it } from 'vitest';
import { getTeamsDescriptor } from './get-teams-descriptor';

describe('getTeamsDescriptor', () => {
  it('describes Microsoft Teams on the web', () => {
    expect(getTeamsDescriptor()).toEqual({
      id: 'teams',
      label: 'Microsoft Teams',
      origins: [
        'https://teams.microsoft.com/*',
        'https://teams.live.com/*',
        'https://teams.cloud.microsoft/*',
      ],
      fixturePrefix: '/teams',
      fixtureHostname: 'teams.microsoft.com',
    });
  });

  it('returns a fresh object each time', () => {
    expect(getTeamsDescriptor()).not.toBe(getTeamsDescriptor());
  });
});
