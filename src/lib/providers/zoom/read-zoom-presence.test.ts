import { beforeEach, describe, expect, it } from 'vitest';
import type { MicState } from '@/lib/providers/types';
import { createFakeZoomPage, type FakeZoomAudio } from '@/test/fakes/create-fake-zoom-page';
import { readZoomDomHints } from './read-zoom-dom-hints';
import { readZoomPresence } from './read-zoom-presence';

const STRIP = { x: 0, y: 0, width: 207, height: 117 };
const LARGE = { x: 0, y: 120, width: 1280, height: 600 };
/** User ids as Zoom numbers them: 1024 apart, the low part names a person's other streams. */
const ANA = '16778240';
const BEN = '16779264';

const read = () => readZoomPresence(document, readZoomDomHints(document));
const people = () => read().participants.map(({ key, name }) => [key, name]);

describe('readZoomPresence', () => {
  beforeEach(() => document.body.replaceChildren());

  it('reads the people on the stage by name, the count from the counter, and no self', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 3 });
    page.addVideoTile({ nodeId: ANA, name: 'Ana Souza' });
    page.addAvatarTile({ name: 'Ben Carter' });
    expect(read()).toEqual({
      participants: [
        { key: 'name:Ana Souza', name: 'Ana Souza', self: null },
        { key: 'name:Ben Carter', name: 'Ben Carter', self: null },
      ],
      source: 'stage',
      count: 3,
      share: { kind: 'none' },
      selfMic: 'live',
    });
  });

  it("keys a person by name, whatever their camera and Zoom's tile order do", () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 2 });
    page.addAvatarTile({ name: 'Ana Souza' });
    const before = people();
    document.body.replaceChildren();
    page.showMeeting({ participants: 2 });
    page.addVideoTile({ nodeId: BEN, name: 'Ben Carter' });
    page.addVideoTile({ nodeId: ANA, name: 'Ana Souza' });
    expect(people()).toEqual([['name:Ben Carter', 'Ben Carter'], ...before]);
  });

  it('tells two people of one name apart, in the order the page shows them', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 3 });
    page.addVideoTile({ nodeId: ANA, name: 'Ana' });
    page.addAvatarTile({ name: ' Ana ' });
    expect(people()).toEqual([
      ['name:Ana', 'Ana'],
      ['name:Ana#2', 'Ana'],
    ]);
  });

  describe('speaker view: the large tile is a slot (`node-id="1"`) showing whoever speaks', () => {
    it('is a person when the strip does not show them', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 2 });
      page.addVideoTile({ nodeId: ANA, name: 'Zen Recorder', rect: STRIP });
      page.addVideoTile({ nodeId: '1', name: 'Ben Carter', rect: LARGE });
      expect(people()).toEqual([
        ['name:Zen Recorder', 'Zen Recorder'],
        ['name:Ben Carter', 'Ben Carter'],
      ]);
    });

    it('is the same person as the strip tile of that name', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 3 });
      page.addVideoTile({ nodeId: '1', name: 'Ben Carter', rect: LARGE });
      page.addVideoTile({ nodeId: ANA, name: 'Zen Recorder', rect: STRIP });
      page.addAvatarTile({ name: 'Ben Carter', rect: STRIP });
      expect(people()).toEqual([
        ['name:Zen Recorder', 'Zen Recorder'],
        ['name:Ben Carter', 'Ben Carter'],
      ]);
    });
  });

  it('leaves out a tile without a name: nothing would keep its key', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 2 });
    page.addVideoTile({ nodeId: ANA, name: null });
    page.addAvatarTile({ name: null });
    page.addAvatarTile({ name: 'Ben Carter' });
    expect(people()).toEqual([['name:Ben Carter', 'Ben Carter']]);
  });

  describe('a share', () => {
    it('names the sharer from the stage tile of their user id, and is no person itself', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 3 });
      page.addVideoTile({ nodeId: ANA, name: 'Ana Souza', rect: STRIP });
      page.addVideoTile({ nodeId: BEN, name: 'Ben Carter', rect: STRIP });
      page.startShare({ nodeId: BEN });
      expect(read()).toMatchObject({
        participants: [{ name: 'Ana Souza' }, { name: 'Ben Carter' }],
        share: {
          kind: 'active',
          participantKey: 'name:Ben Carter',
          name: 'Ben Carter',
          self: false,
        },
      });
    });

    it("takes the person from a share's own stream id (its low part set)", () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 2 });
      page.addVideoTile({ nodeId: BEN, name: 'Ben Carter', rect: STRIP });
      page.startShare({ nodeId: String(Number(BEN) + 2) });
      expect(read().share).toMatchObject({ kind: 'active', name: 'Ben Carter' });
    });

    it.each<[string, string | null]>([
      ['the sharer has no camera tile on the stage', BEN],
      ['the share has an empty user id', ''],
      ['the share has no user id', null],
      ['the share names the speaker slot', '1'],
    ])('is a share by someone unnamed when %s', (_label, nodeId) => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 3 });
      page.addVideoTile({ nodeId: ANA, name: 'Ana Souza', rect: STRIP });
      page.addVideoTile({ nodeId: '1', name: 'Speaker', rect: LARGE });
      page.addAvatarTile({ name: 'Ben Carter', rect: STRIP });
      const share = page.startShare({ nodeId: nodeId ?? '' });
      if (nodeId === null) share.removeAttribute('node-id');
      expect(read().share).toEqual({
        kind: 'active',
        participantKey: null,
        name: null,
        self: false,
      });
    });

    it('is over once the share container shows no share again', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ participants: 2 });
      page.addVideoTile({ nodeId: ANA, name: 'Ana Souza' });
      page.startShare({ nodeId: ANA });
      page.stopShare();
      expect(read().share).toEqual({ kind: 'none' });
      expect(people()).toEqual([['name:Ana Souza', 'Ana Souza']]);
    });
  });

  it('counts the people in the meeting, not the waiting room the host is shown', () => {
    createFakeZoomPage(document).showMeeting({ host: true, participants: 2, waiting: 3 });
    expect(read().count).toBe(2);
  });

  it.each([
    // Never fewer than the user, who reads the page.
    ['a counter of zero', 0, 1],
    ['no counter', null, null],
  ])('counts with %s: %j', (_label, participants, count) => {
    createFakeZoomPage(document).showMeeting({ participants });
    expect(read().count).toBe(count);
  });

  it.each<[FakeZoomAudio, MicState]>([
    ['unmuted', 'live'],
    ['muted', 'muted'],
    ['not-joined', 'not-connected'],
  ])('reads the microphone %s as %s', (audio, selfMic) => {
    createFakeZoomPage(document).showMeeting({ audio });
    expect(read().selfMic).toBe(selfMic);
  });
});
