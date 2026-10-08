import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTeamsPage } from '@/test/fakes/create-fake-teams-page';
import { readTeamsRosterCount } from './read-teams-roster-count';

describe('readTeamsRosterCount', () => {
  const page = createFakeTeamsPage(document);
  beforeEach(() => document.body.replaceChildren());

  it.each([
    ['6', 6],
    [' 1 ', 1],
    ['99+', 99],
    ['0', 0],
  ])('reads the People badge "%s"', (roster, expected) => {
    page.showCall({ roster });
    expect(readTeamsRosterCount(document)).toBe(expected);
  });

  it.each([[null], [''], ['new'], ['-3']])('cannot tell from the badge %j', (roster) => {
    page.showCall({ roster });
    expect(readTeamsRosterCount(document)).toBeNull();
  });

  it('ignores the badges of other toolbar buttons', () => {
    const call = page.showCall();
    const chat = document.createElement('button');
    chat.id = 'chat-button';
    const badge = document.createElement('span');
    badge.setAttribute('data-tid', 'toolbar-item-badge');
    badge.textContent = '4';
    chat.append(badge);
    call.append(chat);
    expect(readTeamsRosterCount(document)).toBeNull();
  });
});
