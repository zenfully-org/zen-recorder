import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTeamsPage } from '@/test/fakes/create-fake-teams-page';
import { readTeamsCallScreen } from './read-teams-call-screen';

describe('readTeamsCallScreen', () => {
  const page = createFakeTeamsPage(document);
  beforeEach(() => document.body.replaceChildren());

  it('sees no call on a page without call UI', () => {
    document.body.append(document.createElement('main'));
    expect(readTeamsCallScreen(document)).toBe('none');
  });

  it.each([
    ['prejoin', () => page.showPrejoin()],
    ['connecting', () => page.showConnecting()],
    ['lobby', () => page.showLobby()],
    ['call', () => page.showCall()],
  ] as const)('recognizes the %s screen', (expected, build) => {
    build();
    expect(readTeamsCallScreen(document)).toBe(expected);
  });

  it('does not take a call screen without the hang-up button for the call', () => {
    page.showCall().querySelector('#hangup-button')?.remove();
    expect(readTeamsCallScreen(document)).toBe('none');
  });

  it('lets a waiting screen win over call controls that are already rendered', () => {
    page.showCall();
    page.showLobby();
    expect(readTeamsCallScreen(document)).toBe('lobby');
    document.body.replaceChildren();
    page.showCall();
    page.showConnecting();
    expect(readTeamsCallScreen(document)).toBe('connecting');
    document.body.replaceChildren();
    page.showCall();
    page.showPrejoin();
    expect(readTeamsCallScreen(document)).toBe('prejoin');
  });
});
