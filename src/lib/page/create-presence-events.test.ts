import { describe, expect, it } from 'vitest';
import type { ParticipantIds } from '@/lib/notes/assign-participant-ids';
import type { MeetingPresence, Participant } from '@/lib/providers/types';
import type { NotesCapabilities } from '@/lib/types';
import { createPresenceEvents } from './create-presence-events';

const TEAMS: NotesCapabilities = {
  count: true,
  roster: false,
  self: true,
  share: true,
  shareBy: true,
};
const ZOOM: NotesCapabilities = {
  count: true,
  roster: false,
  self: false,
  share: true,
  shareBy: true,
};

const person = (key: string, name: string | null, self: boolean | null = false): Participant => ({
  key,
  name,
  self,
});
const JO = person('name:Jo', 'Jo', true);
const ANA = person('name:Ana', 'Ana');
const BEN = person('name:Ben', 'Ben');

const call = (
  participants: Participant[],
  more: Partial<MeetingPresence> = {},
): MeetingPresence => ({
  participants,
  source: 'stage',
  count: participants.length,
  share: { kind: 'none' },
  selfMic: null,
  ...more,
});

/** Presence events of one recording on a page whose readings the test sets (`page.reading`). */
function setup(
  capabilities = TEAMS,
  options: { names?: boolean; ids?: { current: ParticipantIds | null } } = {},
) {
  const page: { reading: MeetingPresence | null } = { reading: call([JO, ANA]) };
  const names = { on: options.names ?? true };
  const ids = options.ids ?? { current: null };
  const events = createPresenceEvents<{ atMs: number }>({
    source: { read: () => page.reading, capabilities },
    meetingId: 'abc-defg-hij',
    ids,
    names: () => names.on,
  });
  return { events, page, names, ids };
}

const at = (atMs: number) => ({ atMs });

describe('createPresenceEvents', () => {
  it('starts with a roster of who is in the call, the user first, and what the service can show', () => {
    const { events, page } = setup();
    page.reading = call([ANA, JO]);
    expect(events.atStart(at(0))).toEqual([
      {
        stamp: at(0),
        body: {
          type: 'roster',
          why: 'start',
          source: 'stage',
          participants: [
            { id: 'p1', name: 'Jo', self: true, identity: 'service-id' },
            { id: 'p2', name: 'Ana', self: false, identity: 'display-name' },
          ],
          count: 2,
          share: 'none',
          shareBy: null,
          stale: false,
          readAtMs: 0,
          capabilities: TEAMS,
        },
      },
    ]);
  });

  it('lists the user where the page does not mark them, and their own tile as someone else', () => {
    // Zoom's stage: the user's tile is there, but the page does not say it is theirs.
    const { events, page } = setup(ZOOM);
    page.reading = call([person('name:Jo', 'Jo', null), ANA]);
    const [roster] = events.atStart(at(0));
    expect(roster?.body).toMatchObject({
      participants: [
        { id: 'p1', name: null, self: true },
        { id: 'p2', name: 'Jo', self: null },
        { id: 'p3', name: 'Ana', self: false },
      ],
      count: 2,
    });
  });

  it('names who shares, the user included', () => {
    const { events, page } = setup();
    const ana = { kind: 'active', participantKey: 'name:Ana', name: 'Ana', self: false } as const;
    page.reading = call([JO, ANA], { share: ana });
    expect(events.atStart(at(0))[0]?.body).toMatchObject({
      share: 'active',
      shareBy: { id: 'p2' },
    });
    page.reading = call([JO, ANA], { share: { ...ana, participantKey: null, self: true } });
    expect(events.atStop(at(1000)).at(-1)?.body).toMatchObject({ shareBy: { id: 'p1' } });
  });

  it('names nobody for a share whose sharer the page does not show', () => {
    const { events, page } = setup();
    const share = { kind: 'active', participantKey: 'name:Kai', name: 'Kai', self: false } as const;
    page.reading = call([JO, ANA], { share });
    expect(events.atStart(at(0))[0]?.body).toMatchObject({ share: 'active', shareBy: null });
    page.reading = call([JO, ANA], { share: { ...share, participantKey: null } });
    expect(events.atStop(at(1000)).at(-1)?.body).toMatchObject({ share: 'active', shareBy: null });
  });
});

describe('createPresenceEvents, between the start and the stop', () => {
  it('tells who joined and left from one tick to the next', () => {
    const { events, page } = setup();
    events.atStart(at(0));
    page.reading = call([JO, ANA, BEN]);
    expect(events.observe(at(1000))).toEqual([
      {
        stamp: at(1000),
        body: {
          type: 'participant-joined',
          participant: { id: 'p3', name: 'Ben', self: false, identity: 'display-name' },
          count: 3,
        },
      },
    ]);
  });

  it('counts the user on a stage that does not show them, where the page marks the user', () => {
    // The self view is hidden: the stage shows everyone else, which is the whole call.
    const { events, page } = setup();
    page.reading = call([ANA], { count: 2 });
    events.atStart(at(0));
    page.reading = call([ANA, BEN], { count: 3 });
    expect(events.observe(at(1000)).map(({ body }) => body.type)).toEqual(['participant-joined']);
  });

  it('starts without a reading when the page shows no call, and says so', () => {
    const { events, page } = setup();
    page.reading = null;
    expect(events.atStart(at(0)).map(({ body }) => body)).toEqual([
      {
        type: 'roster',
        why: 'start',
        source: null,
        participants: [{ id: 'p1', name: null, self: true, identity: 'service-id' }],
        count: null,
        share: 'unknown',
        shareBy: null,
        stale: false,
        readAtMs: 0,
        capabilities: TEAMS,
      },
      { type: 'coverage-lost', signal: 'participants', reason: 'presence-unavailable' },
    ]);
  });
});

describe('createPresenceEvents, at the stop', () => {
  it('ends with the last reading, marked stale, when the page no longer shows the call', () => {
    // After a leave the page shows no call: the end still says who was there.
    const { events, page } = setup();
    events.atStart(at(0));
    page.reading = call([JO, ANA, BEN]);
    events.observe(at(1000));
    page.reading = null;
    const stop = events.atStop(at(2000));
    expect(stop.map(({ stamp, body }) => [stamp.atMs, body.type])).toEqual([[2000, 'roster']]);
    expect(stop.at(-1)?.body).toMatchObject({
      why: 'stop',
      participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      count: 3,
      stale: true,
      readAtMs: 1000,
      capabilities: null,
    });
  });

  it('ends with a fresh reading, and tells first what still waited', () => {
    const { events, page } = setup();
    page.reading = call([JO, ANA, BEN]);
    events.atStart(at(0));
    page.reading = call([JO, ANA]);
    const stop = events.atStop(at(1000));
    expect(stop.map(({ body }) => body.type)).toEqual(['participant-left', 'roster']);
    expect(stop.at(-1)?.body).toMatchObject({
      why: 'stop',
      stale: false,
      readAtMs: 1000,
      count: 2,
    });
  });

  it('ends without any reading as it started', () => {
    const { events, page } = setup();
    page.reading = null;
    events.atStart(at(0));
    expect(events.atStop(at(1000)).map(({ body }) => body)).toEqual([
      expect.objectContaining({ why: 'stop', source: null, stale: false, readAtMs: 1000 }),
    ]);
  });

  it('says again who is in the call when asked, from the last reading', () => {
    const { events, page } = setup();
    events.atStart(at(0));
    page.reading = call([JO, ANA, BEN]);
    events.observe(at(1000));
    expect(events.reannounce(at(1500))).toEqual([
      {
        stamp: at(1500),
        body: expect.objectContaining({
          why: 'reannounce',
          participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }].map((ref) =>
            expect.objectContaining(ref),
          ),
          stale: false,
          readAtMs: 1000,
          capabilities: null,
        }),
      },
    ]);
    page.reading = null;
    events.observe(at(2000));
    expect(events.reannounce(at(2500))[0]?.body).toMatchObject({ stale: true, readAtMs: 1000 });
  });
});

describe('createPresenceEvents, ids and names', () => {
  it('keeps the ids of the meeting across its recordings', () => {
    const ids = { current: null };
    const first = setup(TEAMS, { ids });
    first.page.reading = call([JO, BEN]);
    first.events.atStart(at(0));
    const second = setup(TEAMS, { ids });
    second.page.reading = call([JO, ANA, BEN]);
    expect(second.events.atStart(at(1000))[0]?.body).toMatchObject({
      participants: [{ id: 'p1' }, { id: 'p3', name: 'Ana' }, { id: 'p2', name: 'Ben' }],
    });
  });

  it('writes no name without names, and keeps the ids, the user and the counts', () => {
    const { events, page, names } = setup(TEAMS, { names: false });
    const share = { kind: 'active', participantKey: 'name:Ana', name: 'Ana', self: false } as const;
    page.reading = call([JO, ANA]);
    const told = [...events.atStart(at(0))];
    page.reading = call([JO, person('name:Ana', 'Ana Souza'), BEN], { share });
    told.push(...events.observe(at(1000)));
    expect(JSON.stringify(told.map(({ body }) => body))).not.toMatch(/Jo|Ana|Ben/);
    names.on = true;
    page.reading = call([JO, BEN], { share: { kind: 'none' } });
    told.push(...events.atStop(at(2000)).slice(0, -1));
    expect(told.map(({ body }) => body.type)).toEqual([
      'roster',
      'participant-renamed',
      'participant-joined',
      'share-started',
      'participant-left',
      'share-stopped',
    ]);
    expect(told[1]?.body).toMatchObject({ participant: { id: 'p2', name: null }, from: null });
    expect(told[0]?.body).toMatchObject({
      participants: [
        { id: 'p1', name: null, self: true },
        { id: 'p2', name: null, self: false },
      ],
      count: 2,
    });
    expect(told[3]?.body).toMatchObject({ by: { id: 'p2', name: null } });
    // Names are written again once they are collected again.
    expect(told.at(-1)?.body).toMatchObject({ by: { name: 'Ana Souza' } });
  });
});

describe("createPresenceEvents, the user's own share", () => {
  const seenAt = (atMs: number) => () => at(atMs);
  const told = (events: { stamp: { atMs: number }; body: { type: string } }[]) =>
    events.map(({ stamp, body }) => ({ atMs: stamp.atMs, ...body }));
  const jo = { id: 'p1', name: 'Jo', self: true, identity: 'service-id' };

  it('tells the user starting and stopping a share, by the user, as of when it was seen', () => {
    const { events } = setup();
    events.atStart(at(0), false);
    expect(told(events.ownShare(true, seenAt(1000)))).toEqual([
      { atMs: 1000, type: 'share-started', by: jo },
    ]);
    expect(events.ownShare(true, seenAt(2000))).toEqual([]);
    expect(told(events.ownShare(false, seenAt(3000)))).toEqual([
      { atMs: 3000, type: 'share-stopped', by: jo },
    ]);
  });

  it('tells a share running at the start in the start only', () => {
    const { events } = setup();
    events.atStart(at(0), true);
    expect(events.ownShare(true, seenAt(1000))).toEqual([]);
    expect(told(events.ownShare(false, seenAt(2000))).map(({ type }) => type)).toEqual([
      'share-stopped',
    ]);
  });

  it('tells nothing where the recorder cannot see the page share', () => {
    const { events } = setup();
    events.atStart(at(0));
    expect(events.ownShare(null, seenAt(1000))).toEqual([]);
  });

  // Teams marks the user's share: the browser told it already, and the page's is the same share.
  it("tells the user's share once when the page shows it too", () => {
    const { events, page } = setup();
    events.atStart(at(0), false);
    const own = { kind: 'active', participantKey: null, name: 'Jo', self: true } as const;
    page.reading = call([JO, ANA], { share: own });
    const shared = [...events.ownShare(true, seenAt(1000)), ...events.observe(at(1000))];
    expect(shared.map(({ body }) => body.type)).toEqual(['share-started']);
  });

  it('names nobody without names', () => {
    const { events } = setup(TEAMS, { names: false });
    events.atStart(at(0), false);
    expect(events.ownShare(true, seenAt(1000))[0]?.body).toMatchObject({ by: { name: null } });
  });
});

describe('createPresenceEvents, the microphone as the page shows it', () => {
  it('gives the state of the last reading of the call, and none where the page shows none', () => {
    const { events, page } = setup();
    expect(events.selfMic()).toBeNull();
    page.reading = call([JO, ANA], { selfMic: 'muted' });
    events.atStart(at(0));
    expect(events.selfMic()).toBe('muted');
    // No reading of the call for a while: the last state the page showed holds.
    page.reading = null;
    events.observe(at(1000));
    expect(events.selfMic()).toBe('muted');
    page.reading = call([JO, ANA], { selfMic: null });
    events.observe(at(2000));
    expect(events.selfMic()).toBeNull();
  });
});
