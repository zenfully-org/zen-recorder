import { beforeEach, describe, expect, it } from 'vitest';
import type { MicState } from '@/lib/providers/types';
import { createFakeTeamsPage, type FakeTeamsMic } from '@/test/fakes/create-fake-teams-page';
import { readTeamsPresence } from './read-teams-presence';

const teams = createFakeTeamsPage(document);
const ANA = { name: 'Ana Silva' };
const SELF = { name: 'Zen Recorder guest', self: true };

const people = () =>
  readTeamsPresence(document)?.participants.map(({ key, name, self }) => [key, name, self]);

describe('readTeamsPresence', () => {
  beforeEach(() => document.body.replaceChildren());

  it('reads the people on the stage, the user by the tile without a voice outline', () => {
    teams.showCall({ roster: '2', tiles: [ANA, SELF] });
    expect(readTeamsPresence(document)).toEqual({
      participants: [
        { key: 'name:Ana Silva', name: 'Ana Silva', self: false },
        { key: 'name:Zen Recorder guest', name: 'Zen Recorder guest', self: true },
      ],
      source: 'stage',
      count: 2,
      share: { kind: 'none' },
      selfMic: 'live',
    });
  });

  it.each([
    ['the pre-join screen', () => teams.showPrejoin()],
    ['the connecting screen', () => teams.showConnecting()],
    ['the lobby', () => teams.showLobby()],
    // The user opened the chat or the calendar: the call goes on, off screen.
    ['a page without the call screen', () => undefined],
  ])('cannot tell on %s', (_label, show) => {
    show();
    expect(readTeamsPresence(document)).toBeNull();
  });

  it('keys a person by name, whatever their camera and the tile ids do', () => {
    teams.showCall({ tiles: [{ ...ANA, elementId: 'tile-a' }, SELF] });
    const before = people();
    document.body.replaceChildren();
    teams.showCall({ tiles: [SELF, { ...ANA, camera: false, elementId: 'tile-b' }] });
    expect(people()).toEqual([...(before ?? []).slice(1), ...(before ?? []).slice(0, 1)]);
  });

  it('tells two people of one name apart', () => {
    teams.showCall({ tiles: [ANA, ANA, SELF] });
    expect(people()?.map(([key]) => key)).toEqual([
      'name:Ana Silva',
      'name:Ana Silva#2',
      'name:Zen Recorder guest',
    ]);
  });

  it('leaves out tiles that do not name a person', () => {
    const call = teams.showCall({ tiles: [ANA, SELF] });
    const stage = call.querySelector('[data-tid="modern-stage-wrapper"]');
    // A small camera-off tile without the stream attributes, and a tile with an empty name.
    const small = document.createElement('div');
    small.append(document.createElement('img'));
    const unnamed = teams.createTile({ name: ' ', elementId: null });
    stage?.append(small, unnamed);
    expect(people()).toEqual([
      ['name:Ana Silva', 'Ana Silva', false],
      ['name:Zen Recorder guest', 'Zen Recorder guest', true],
    ]);
  });

  it.each([
    // A bot has no voice outline either: which one is the user cannot be told.
    [
      'two tiles without an outline',
      [ANA, SELF, { name: 'Notetaker', self: true }],
      [false, null, null],
    ],
    // The user's tile is not on the stage (paging): everyone shown has an outline.
    ['no tile without an outline', [ANA, { name: 'Ben Carter' }], [false, false]],
  ])('marks the user only when one tile can be theirs: %s', (_label, tiles, selves) => {
    teams.showCall({ tiles });
    expect(people()?.map(([, , self]) => self)).toEqual(selves);
  });

  describe('a share', () => {
    it('names the sharer from the share tile, and is no person of its own', () => {
      teams.showCall({ tiles: [ANA, SELF, { ...ANA, stream: 'ScreenSharing' }] });
      expect(readTeamsPresence(document)).toMatchObject({
        participants: [{ name: 'Ana Silva' }, { name: 'Zen Recorder guest' }],
        share: { kind: 'active', participantKey: 'name:Ana Silva', name: 'Ana Silva', self: false },
      });
    });

    it("is the user's own when it carries the user's name", () => {
      teams.showCall({ tiles: [ANA, SELF, { name: SELF.name, stream: 'ScreenSharing' }] });
      expect(readTeamsPresence(document)?.share).toEqual({
        kind: 'active',
        participantKey: 'name:Zen Recorder guest',
        name: 'Zen Recorder guest',
        self: true,
      });
    });

    it("is not the user's own while the user cannot be told", () => {
      teams.showCall({
        tiles: [{ name: 'Notetaker', self: true }, SELF, { ...SELF, stream: 'ScreenSharing' }],
      });
      expect(readTeamsPresence(document)?.share).toMatchObject({ kind: 'active', self: false });
    });

    it('is a share by someone unnamed when the share tile has no name', () => {
      teams.showCall({ tiles: [ANA, SELF, { name: ' ', stream: 'ScreenSharing' }] });
      expect(readTeamsPresence(document)?.share).toEqual({
        kind: 'active',
        participantKey: null,
        name: null,
        self: false,
      });
    });
  });

  it.each([
    ['3', 3],
    ['12+', 12],
    // Never fewer than the user, who reads the page.
    ['0', 1],
    [null, null],
  ])('counts the People badge %j as %j', (roster, count) => {
    teams.showCall({ roster, tiles: [ANA, SELF] });
    expect(readTeamsPresence(document)?.count).toBe(count);
  });

  it.each<[FakeTeamsMic | null, MicState | null]>([
    ['on', 'live'],
    ['off', 'muted'],
    // The organizer does not let attendees speak: nobody hears the microphone.
    ['prohibited', 'muted'],
    [null, null],
  ])('reads the microphone icon %j as %j', (mic, selfMic) => {
    teams.showCall({ mic, tiles: [ANA, SELF] });
    expect(readTeamsPresence(document)?.selfMic).toBe(selfMic);
  });
});
