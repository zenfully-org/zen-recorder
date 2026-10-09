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
  MeetingProvider,
  ProviderDescriptor,
} from '@/lib/providers/types';
import {
  createFakeCaptureWindow,
  type FakeCaptureWindow,
} from '@/test/fakes/create-fake-capture-window';

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
  });
}
