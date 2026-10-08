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
}

const TARGETS: FixtureTarget[] = [
  {
    id: 'meet',
    label: 'Google Meet',
    meetingPath: '/abc-defg-hij',
    tiles: { call: 2, sharing: 3 },
  },
  {
    id: 'zoom',
    label: 'Zoom',
    meetingPath: '/zoom/wc/1234567890/join',
    tiles: { call: 2, sharing: 3 },
    hostMeetingPath: '/zoom/wc/1234567890/start',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    // The light meeting page of an anonymous guest: the thread id travels in `coords` (base64 JSON).
    meetingPath:
      '/teams/light-meetings/launch?anon=true&coords=eyJjb252ZXJzYXRpb25JZCI6IjE5Om1lZXRpbmdfWm1sNGRIVnlaUzFqWVd4c0B0aHJlYWQudjIiLCJ0ZW5hbnRJZCI6IjExMTExMTExLTIyMjItNDMzMy04NDQ0LTU1NTU1NTU1NTU1NSJ9',
    tiles: { call: 2, sharing: 3 },
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
