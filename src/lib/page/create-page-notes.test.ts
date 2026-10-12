import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingLocation, MeetingPage, MeetingPresence } from '@/lib/providers/types';
import { createPageNotes } from './create-page-notes';

const LOCATION: MeetingLocation = {
  hostname: 'meet.google.com',
  pathname: '/abc-defg-hij',
  search: '',
  hash: '',
};
const CALL: MeetingPresence = {
  participants: [
    { key: 'spaces/x/devices/1', name: 'Jo', self: true },
    { key: 'spaces/x/devices/2', name: 'Ana', self: false },
  ],
  source: 'stage',
  count: 2,
  share: { kind: 'unknown' },
  selfMic: null,
};

describe('createPageNotes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a recording's events to the bridge, with who the provider reads in the call on the page", async () => {
    const sent: [string, unknown][] = [];
    const pages: MeetingPage[] = [];
    const notes = createPageNotes({
      win: window,
      messenger: {
        sendMessage: async (type, batch) => {
          sent.push([type, batch]);
          return { ok: true, rejected: 0 };
        },
      },
      provider: {
        readPresence: (page) => {
          pages.push(page);
          return CALL;
        },
        notesCapabilities: { count: true, roster: false, self: true, share: false, shareBy: false },
      },
      readLocation: () => LOCATION,
    });
    const recording = {
      id: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
      encoder: { mediaTimeMs: () => 0, state: () => 'recording' as const },
      video: null,
    };
    notes.configure({ eventsProtocol: 1, meetingNotes: 'withNames' });
    const start = { trigger: 'command', meetingId: 'abc-defg-hij', audioOnlyReason: null } as const;
    const seen = { connected: true, mic: 'live', title: 'Standup', visible: true } as const;
    notes.recordingStarted(recording, start, seen);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pages).toEqual([{ location: LOCATION, document }]);
    expect(sent.map(([type]) => type)).toEqual(['page:events']);
    const roster = {
      type: 'roster',
      why: 'start',
      participants: [
        { id: 'p1', name: 'Jo', self: true, identity: 'service-id' },
        { id: 'p2', name: 'Ana', self: false, identity: 'service-id' },
      ],
      share: 'unknown',
    };
    expect(sent[0]?.[1]).toEqual(
      expect.objectContaining({ events: [expect.anything(), expect.objectContaining(roster)] }),
    );
  });
});
