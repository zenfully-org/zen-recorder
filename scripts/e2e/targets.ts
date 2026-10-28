/**
 * The fixture pages the end-to-end scenarios run against, one per provider. A provider is skipped
 * (with a notice) until its `src/test/fixtures/fake-<id>.html` exists.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '../../src/lib/types';
import { PORT, ROOT } from './harness';

export interface FixtureTarget {
  id: ProviderId;
  label: string;
  /** A meeting URL path on the fixture server (provider prefix included). */
  meetingPath: string;
  /** Tiles the fake page shows in a call, and with the remote screen share on. */
  tiles: { call: number; sharing: number };
  /**
   * The meeting as its host opens it, for a fake page that models the host's side: joined alone,
   * a guest knocks (`knock()`) and is let in (`letIn()`). Without it scenario 17 is skipped.
   */
  hostMeetingPath?: string;
  /**
   * Another address the service opens the same meeting at (Meet's `/meet/<code>`), with the
   * meeting's id and title the provider must read there: the fake page titles its tab the way
   * the service does at that address. Without it scenario 100 is skipped.
   */
  otherAddress?: { path: string; meetingId: string; title: string };
  /**
   * Two addresses the provider does not know, of different shapes, at which the fake page still
   * holds a call, as it would once the service moved its meetings again, and the shape the
   * Diagnostics line gives each. Without it scenario 101 is skipped: Zoom counts the user admitted
   * only at a meeting number it reads in the address, and Teams names a call by its call screen
   * whatever the address, so neither shows a call at an address it does not know.
   */
  unknownAddresses?: { path: string; shape: string }[];
  /**
   * The service holds a call where WebRTC is switched off (Zoom's web client, over WebSockets) and
   * the fake page models it. Scenario 79 then records a call in a browser without WebRTC.
   */
  joinsWithoutWebRtc?: true;
  /** The names the fake page gives the user and the remote participant a call starts with. */
  names: { self: string; remote: string };
  /**
   * What the provider tells about the people on this page: who shares (`shareBy`), which tile is
   * the user's (`self`), how many people there are (`count`), whether the user can share a
   * screen here (`selfShare`), and whether the page shows the user's microphone (`micStates`).
   */
  supports: {
    shareBy: boolean;
    self: boolean;
    count: boolean;
    selfShare: boolean;
    micStates: boolean;
  };
}

const TARGETS: FixtureTarget[] = [
  {
    id: 'meet',
    label: 'Google Meet',
    meetingPath: '/abc-defg-hij',
    tiles: { call: 2, sharing: 3 },
    otherAddress: { path: '/meet/abc-defg-hij', meetingId: 'abc-defg-hij', title: 'Fixture call' },
    unknownAddresses: [
      { path: '/zz/abc-defg-hij', shape: '/aa/aaa-aaaa-aaa' },
      { path: '/call/2026/abc-defg-hij', shape: '/aaaa/0000/aaa-aaaa-aaa' },
    ],
    names: { self: 'You', remote: 'Remote Person' },
    supports: { shareBy: false, self: true, count: true, selfShare: true, micStates: false },
  },
  {
    id: 'zoom',
    label: 'Zoom',
    meetingPath: '/zoom/wc/1234567890/join',
    tiles: { call: 2, sharing: 3 },
    hostMeetingPath: '/zoom/wc/1234567890/start',
    joinsWithoutWebRtc: true,
    names: { self: 'Fixture User', remote: 'Remote Person' },
    supports: { shareBy: true, self: false, count: true, selfShare: true, micStates: true },
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    // The light meeting page of an anonymous guest: the thread id travels in `coords` (base64 JSON).
    meetingPath:
      '/teams/light-meetings/launch?anon=true&coords=eyJjb252ZXJzYXRpb25JZCI6IjE5Om1lZXRpbmdfWm1sNGRIVnlaUzFqWVd4c0B0aHJlYWQudjIiLCJ0ZW5hbnRJZCI6IjExMTExMTExLTIyMjItNDMzMy04NDQ0LTU1NTU1NTU1NTU1NSJ9',
    tiles: { call: 2, sharing: 3 },
    names: { self: 'Zen Recorder guest', remote: 'Ana Silva' },
    supports: { shareBy: true, self: true, count: true, selfShare: true, micStates: true },
  },
];

export const fixtureFile = (id: ProviderId): string =>
  path.join(ROOT, 'src/test/fixtures', `fake-${id}.html`);

export const meetingUrl = (target: FixtureTarget, meetingPath = target.meetingPath): string =>
  `http://localhost:${PORT}${meetingPath}`;

/** Targets to run: every provider with a fixture page, narrowed by `E2E_PROVIDERS=meet,zoom`. */
export function selectTargets(): { run: FixtureTarget[]; skipped: FixtureTarget[] } {
  const wanted = (process.env['E2E_PROVIDERS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const chosen = TARGETS.filter((target) => wanted.length === 0 || wanted.includes(target.id));
  return {
    run: chosen.filter((target) => existsSync(fixtureFile(target.id))),
    skipped: chosen.filter((target) => !existsSync(fixtureFile(target.id))),
  };
}
