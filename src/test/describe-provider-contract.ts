/**
 * The contract every meeting provider must honour, as a reusable test suite. Each provider's
 * `create-<id>-provider.test.ts` calls `describeProviderContract` with builders that put its own
 * DOM into the test document, so feature parity between providers is checked, not assumed.
 */
import { describe, expect, it } from 'vitest';
import { getProviderCatalog } from '@/lib/providers/get-provider-catalog';
import type {
  CaptureListener,
  MeetingLocation,
  MeetingPresence,
  MeetingProvider,
  NotesCapabilities,
  ProviderDescriptor,
} from '@/lib/providers/types';
import {
  createFakeCaptureWindow,
  type FakeCaptureWindow,
} from '@/test/fakes/create-fake-capture-window';

/** A call the user is in, as the `call` page builder shows it. */
interface CallSpec {
  /** Everyone in the call but the user, by display name; `camera: false` shows them without video. */
  others: { name: string; camera?: boolean }[];
  /** One of `others` shares a screen. */
  share?: { by: string } | null;
}

export interface ProviderContractOptions {
  descriptor: ProviderDescriptor;
  createProvider: () => MeetingProvider;
  /**
   * Each builder fills `document` with the page state it is named after and returns the location
   * the provider would see there (as on the real service, not a fixture URL).
   */
  pages: {
    /** Not a meeting: the service's home page, a chat view, the page after leaving. */
    landing: () => MeetingLocation;
    /** A meeting the user is not in yet: pre-join screen or lobby. Every real provider has one. */
    lobby?: () => MeetingLocation;
    /** Admitted and in the call, showing the user's own tile and at least one remote tile. */
    inCall: () => MeetingLocation;
    /**
     * Admitted and in the call described by `spec`: the user's own tile, a tile per person of
     * `others`, a share when `spec.share` says so, and wherever the page counts people,
     * `others.length + 1`. The same spec builds the same page again, but for the ids the page
     * gives each element it mounts.
     */
    call: (spec: CallSpec) => MeetingLocation;
  };
  /** How many tiles the `inCall` page shows. */
  inCallTiles: number;
  /** A window double with whatever globals the provider's capture patches (default: WebRTC). */
  createWindow?: () => FakeCaptureWindow;
}

const MATCH_PATTERN_RE = /^https:\/\/(\*\.)?[a-z0-9.-]+\/\*$/;
const EMPTY_LOCATION: MeetingLocation = { hostname: '', pathname: '/', search: '', hash: '' };

function clearDocument(): void {
  document.title = '';
  document.body.replaceChildren();
}

function createListener(): CaptureListener {
  return {
    remoteAudioTrackAdded: () => undefined,
    remoteAudioTrackEnded: () => undefined,
    connectionsChanged: () => undefined,
    micTrackAdded: () => undefined,
  };
}

const ANA = 'Ana Souza';
const BEN = 'Ben Carter';

const CAPABILITIES = ['count', 'roster', 'self', 'share', 'shareBy'] as const;

/** The capabilities a reading draws on: what it states that only they could show. */
function capabilitiesUsed(reading: MeetingPresence): Record<keyof NotesCapabilities, boolean> {
  const { share } = reading;
  const active = share.kind === 'active' ? share : null;
  return {
    count: reading.count !== null,
    roster: reading.source === 'roster',
    self: reading.participants.some((person) => person.self === true) || active?.self === true,
    share: share.kind !== 'unknown',
    shareBy: active !== null && (active.participantKey !== null || active.name !== null),
  };
}

/** Makes every element of the page throw when measured: a reading must not lay anything out. */
function forbidLayout(): void {
  for (const element of document.querySelectorAll('*')) {
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => {
        throw new Error('readPresence measured the layout');
      },
      configurable: true,
    });
  }
}

export function describeProviderContract(options: ProviderContractOptions): void {
  const { descriptor, createProvider, pages } = options;
  const read = (build: () => MeetingLocation) => {
    clearDocument();
    const location = build();
    return createProvider().readMeeting({ location, document });
  };

  describe(`provider contract: ${descriptor.id}`, () => {
    it('has a descriptor the manifest and the popup can use', () => {
      expect(createProvider().id).toBe(descriptor.id);
      expect(descriptor.label.trim()).not.toBe('');
      expect(descriptor.origins.length).toBeGreaterThan(0);
      for (const origin of descriptor.origins) expect(origin).toMatch(MATCH_PATTERN_RE);
      expect(descriptor.fixtureHostname).not.toBe('');
      expect(descriptor.fixturePrefix).toMatch(/^(\/[a-z0-9-]+)?$/);
      expect(getProviderCatalog()).toContainEqual(descriptor);
    });

    it('reports no meeting on a page that is not one', () => {
      expect(read(pages.landing)).toMatchObject({ meetingId: null, admitted: false });
    });

    it.runIf(pages.lobby)('reports the meeting but no admission before joining', () => {
      const state = read(pages.lobby ?? pages.landing);
      expect(state.meetingId).toEqual(expect.any(String));
      expect(state.meetingId).not.toBe('');
      expect(state.admitted).toBe(false);
    });

    it('reports the meeting, its title and admission once in the call', () => {
      const state = read(pages.inCall);
      expect(state.meetingId).toEqual(expect.any(String));
      expect(state.meetingId).not.toBe('');
      expect(state.title.trim()).not.toBe('');
      expect(state.admitted).toBe(true);
      expect(state.remoteParticipants === null || state.remoteParticipants >= 0).toBe(true);
    });

    it('never throws, whatever the page looks like', () => {
      clearDocument();
      const provider = createProvider();
      const state = provider.readMeeting({ location: EMPTY_LOCATION, document });
      expect(state.admitted).toBe(false);
      expect(state.title.trim()).not.toBe('');
      expect(provider.findTiles(document)).toEqual([]);
      expect(provider.readMicMuted?.(document) ?? null).toBeNull();
      expect(provider.readPresence({ location: EMPTY_LOCATION, document })).toBeNull();
    });

    it('finds the call tiles: unique ids, real elements, sane geometry, one share at most', () => {
      clearDocument();
      pages.inCall();
      const tiles = createProvider().findTiles(document);
      expect(tiles).toHaveLength(options.inCallTiles);
      expect(new Set(tiles.map((tile) => tile.id)).size).toBe(tiles.length);
      expect(tiles.filter((tile) => tile.isShare).length).toBeLessThanOrEqual(1);
      expect(tiles.filter((tile) => tile.isSelf).length).toBeLessThanOrEqual(1);
      for (const tile of tiles) {
        // In the page, possibly inside a shadow root (which `document.contains` does not see).
        if (tile.source) expect(tile.source.isConnected).toBe(true);
        else expect([tile.sourceWidth, tile.sourceHeight]).toEqual([0, 0]);
        const sizes = [tile.rect.width, tile.rect.height, tile.sourceWidth, tile.sourceHeight];
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(tile.rect.x) && Number.isFinite(tile.rect.y)).toBe(true);
        expect(Number.isFinite(tile.frameKey)).toBe(true);
      }
    });

    it('looks the tiles up again on every call', () => {
      clearDocument();
      pages.inCall();
      const provider = createProvider();
      expect(provider.findTiles(document)).toHaveLength(options.inCallTiles);
      document.body.replaceChildren();
      expect(provider.findTiles(document)).toEqual([]);
    });

    it('installs its capture quietly and restores every global on uninstall', () => {
      const page = (options.createWindow ?? createFakeCaptureWindow)();
      const before = { ...Object.getOwnPropertyDescriptors(page.win) };
      const getUserMedia = page.win.navigator.mediaDevices.getUserMedia;
      const capture = createProvider().installCapture(page.win, createListener());
      expect(capture.remoteAudioTracks()).toEqual([]);
      expect(capture.anyConnected()).toBe(false);
      expect(capture.connectionCount()).toBe(0);
      capture.uninstall();
      const after = Object.getOwnPropertyDescriptors(page.win);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      for (const [key, value] of Object.entries(before)) {
        expect(after[key]?.value, `window.${key}`).toBe(value.value);
      }
      expect(page.win.navigator.mediaDevices.getUserMedia).toBe(getUserMedia);
    });

    it('installs its capture where WebRTC is switched off, and still hears the microphone', async () => {
      // With `media.peerconnection.enabled` false, Firefox defines no `RTCPeerConnection` at all.
      const page = (options.createWindow ?? createFakeCaptureWindow)();
      Reflect.deleteProperty(page.win, 'RTCPeerConnection');
      const mics: string[] = [];
      const listener = {
        ...createListener(),
        micTrackAdded: (track: MediaStreamTrack) => mics.push(track.label),
      };
      const capture = createProvider().installCapture(page.win, listener);
      expect(capture.anyConnected()).toBe(false);
      expect(capture.connectionCount()).toBe(0);
      await page.requestMic();
      expect(mics).toEqual(['Fake Microphone']);
      capture.uninstall();
      expect('RTCPeerConnection' in page.win).toBe(false);
    });

    describePresenceContract(options);
  });
}

/** What `readPresence` must keep to, on the pages of `describeProviderContract`. */
function describePresenceContract({ createProvider, pages }: ProviderContractOptions): void {
  const can = createProvider().notesCapabilities;
  /** The presence and the meeting a fresh provider reads on the page `build` shows. */
  const readCall = (build: () => MeetingLocation) => {
    clearDocument();
    const location = build();
    const provider = createProvider();
    return {
      presence: provider.readPresence({ location, document }),
      meeting: provider.readMeeting({ location, document }),
      micMuted: provider.readMicMuted?.(document) ?? null,
    };
  };
  const presenceOn = (build: () => MeetingLocation) => {
    const { presence } = readCall(build);
    if (!presence) throw new Error('readPresence saw no call on a call page');
    return presence;
  };
  const presenceIn = (spec: CallSpec) => presenceOn(() => pages.call(spec));
  const keyOf = (presence: MeetingPresence, name: string) =>
    presence.participants.find((person) => person.name === name)?.key;

  describe('presence', () => {
    it('cannot tell who is in a call the user is not in', () => {
      expect(readCall(pages.landing).presence).toBeNull();
      if (pages.lobby) expect(readCall(pages.lobby).presence).toBeNull();
    });

    it('names each person once, under a key of their own, and one user at most', () => {
      const presence = presenceIn({ others: [{ name: ANA }, { name: BEN }] });
      const names = presence.participants.map((person) => person.name);
      expect(names).toEqual(expect.arrayContaining([ANA, BEN]));
      const keys = presence.participants.map((person) => person.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(presence.participants.filter((person) => person.self === true).length).toBeLessThan(2);
    });

    it('takes no share for a person: the sharer is there once', () => {
      const presence = presenceIn({ others: [{ name: ANA }], share: { by: ANA } });
      expect(presence.participants.filter((person) => person.name === ANA)).toHaveLength(1);
    });

    it('keys a person the same when the page shows them again', () => {
      const spec = { others: [{ name: ANA }, { name: BEN }] };
      const first = presenceIn(spec);
      const again = presenceIn(spec);
      for (const name of [ANA, BEN]) expect(keyOf(again, name)).toBe(keyOf(first, name));
    });

    it('keys a person the same when their camera goes off', () => {
      const on = presenceIn({ others: [{ name: ANA, camera: true }] });
      const off = presenceIn({ others: [{ name: ANA, camera: false }] });
      expect(keyOf(on, ANA)).toEqual(expect.any(String));
      expect(keyOf(off, ANA)).toBe(keyOf(on, ANA));
    });

    it('takes no camera for a share: nobody shares in a call of two', () => {
      const presence = presenceIn({ others: [{ name: ANA }] });
      expect(['none', 'unknown']).toContain(presence.share.kind);
    });

    it.runIf(can.shareBy)('names who shares', () => {
      const presence = presenceIn({ others: [{ name: ANA }, { name: BEN }], share: { by: ANA } });
      expect(presence.share).toEqual({
        kind: 'active',
        participantKey: keyOf(presence, ANA),
        name: ANA,
        self: false,
      });
    });

    it('counts the user and agrees with the meeting on how many others there are', () => {
      const { presence, meeting } = readCall(() =>
        pages.call({ others: [{ name: ANA }, { name: BEN }] }),
      );
      const count = presence?.count ?? null;
      expect(count === null || count === 3).toBe(true);
      if (count !== null && meeting.remoteParticipants !== null) {
        expect(count - 1).toBe(meeting.remoteParticipants);
      }
    });

    it('never states more than the provider says it can observe', () => {
      const pagesToRead = [
        pages.inCall,
        () => pages.call({ others: [{ name: ANA }] }),
        () => pages.call({ others: [{ name: ANA }, { name: BEN, camera: false }] }),
        () => pages.call({ others: [{ name: ANA }, { name: BEN }], share: { by: BEN } }),
      ];
      const beyond = pagesToRead.map((build) => {
        const used = capabilitiesUsed(presenceOn(build));
        return CAPABILITIES.filter((capability) => used[capability] && !can[capability]);
      });
      expect(beyond).toEqual(pagesToRead.map(() => []));
    });

    it('says the microphone is live only where the recorder hears it, if it says anything', () => {
      const { presence, micMuted } = readCall(() => pages.call({ others: [{ name: ANA }] }));
      const selfMic = presence?.selfMic ?? null;
      if (selfMic !== null) expect(micMuted).toBe(selfMic !== 'live');
    });

    it('measures no layout', () => {
      clearDocument();
      const location = pages.call({ others: [{ name: ANA }], share: { by: ANA } });
      forbidLayout();
      expect(createProvider().readPresence({ location, document })).not.toBeNull();
    });
  });
}
