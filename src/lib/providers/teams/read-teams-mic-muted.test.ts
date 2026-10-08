import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTeamsPage } from '@/test/fakes/create-fake-teams-page';
import { readTeamsMicMuted } from './read-teams-mic-muted';

describe('readTeamsMicMuted', () => {
  const page = createFakeTeamsPage(document);
  beforeEach(() => document.body.replaceChildren());

  it('cannot tell without any microphone control', () => {
    expect(readTeamsMicMuted(document)).toBeNull();
    page.showCall({ mic: null });
    expect(readTeamsMicMuted(document)).toBeNull();
  });

  it.each([
    ['on', false],
    ['off', true],
    ['prohibited', true],
  ] as const)('reads the call toolbar icon: %s', (mic, muted) => {
    page.showCall({ mic });
    expect(readTeamsMicMuted(document)).toBe(muted);
  });

  it('treats an icon it does not know as muted', () => {
    page
      .showCall({ mic: 'on' })
      .querySelector('#mic-button svg')
      ?.setAttribute('data-testid', 'ubar-mic-something-new-icon');
    expect(readTeamsMicMuted(document)).toBe(true);
  });

  it('ignores icons of other buttons', () => {
    const call = page.showCall({ mic: null });
    const other = document.createElement('button');
    other.id = 'video-button';
    const icon = document.createElement('svg');
    icon.setAttribute('data-testid', 'ubar-mic-off-icon');
    other.append(icon);
    call.append(other);
    expect(readTeamsMicMuted(document)).toBeNull();
  });

  it.each([
    [true, false],
    [false, true],
  ])('reads the pre-join switch: microphone on = %s', (micOn, muted) => {
    page.showPrejoin({ micOn });
    expect(readTeamsMicMuted(document)).toBe(muted);
    document.body.replaceChildren();
    page.showLobby({ micOn });
    expect(readTeamsMicMuted(document)).toBe(muted);
  });

  it('cannot tell from a switch in an unknown state', () => {
    page.showPrejoin().querySelector('[data-tid="toggle-mute"]')?.setAttribute('data-cid', 'x');
    expect(readTeamsMicMuted(document)).toBeNull();
  });

  it('prefers the call toolbar over a pre-join switch left in the page', () => {
    page.showPrejoin({ micOn: true });
    page.showCall({ mic: 'off' });
    expect(readTeamsMicMuted(document)).toBe(true);
  });
});
