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
      meetingUrl: expect.any(Function),
    });
  });

  // A Teams join link carries its tenant and the user's context; the meeting id alone is no link.
  it('links no meeting', () => {
    expect(getTeamsDescriptor().meetingUrl('19:meeting_abc@thread.v2')).toBeNull();
  });

  it('returns a fresh object each time', () => {
    expect(getTeamsDescriptor()).not.toBe(getTeamsDescriptor());
  });
});
