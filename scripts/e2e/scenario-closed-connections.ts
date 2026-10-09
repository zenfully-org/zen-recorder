/**
 * E2e scenario 83, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * recording whose connections the page closes stops when the grace after the close runs out, not
 * at the recorder's next one-second tick after that.
 *
 * `RTCPeerConnection.close()` fires no event. The recorder reads its connections every 250 ms
 * (Zoom's capture every 100 ms) and wakes its lifecycle at the end of the 5 s grace. Before, it
 * noticed a close only at its next one-second tick and stopped at a later tick, 5 to 6 s after the
 * close depending on where the close fell between two ticks.
 *
 * Each trial opens the meeting, joins, records and closes the call's connections with the call's
 * UI left in place (`closeConnections`), so only the connection-loss rule can end the recording.
 * The page itself times the close to the recorder leaving `recording`. Each must stop within 5.5 s
 * of its close (5 s of grace, at most 0.25 s to notice, and the 20 ms the page reads at), end as
 * `connections-lost` and be saved.
 *
 * How late the old recorder stopped depended on where the close fell between two of its ticks. A
 * recording often starts on a tick (the one that reads that the user was let in), so four trials
 * close 1.5, 1.75, 2 and 2.25 s into their recordings: one of them falls within 0.25 s after a
 * tick, where the old recorder took more than 5.75 s.
 */
import type { Browser } from 'puppeteer';
import { z } from 'zod';
import { currentRecordingId, openMeeting, pageDiagnostics, probe, sleep, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

const TRIALS = 4;
/** How long each trial records before it closes; the next one closes a quarter second later. */
const RECORD_MS = 1_500;
const STAGGER_MS = 250;
/** The grace, the 250 ms read, the page's 20 ms polling and some slack for a busy machine. */
const MAX_STOP_MS = 5_500;

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string() })),
});

/** Joins, records, closes the connections; returns how long the recording kept going after. */
async function trial(browser: Browser, target: FixtureTarget, run: number, problems: string[]) {
  const page = await openMeeting(browser, meetingUrl(target));
  const since = Date.now();
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(RECORD_MS + run * STAGGER_MS);
  const stoppedAfterMs = await page.evaluate(async () => {
    const closedAt = Date.now();
    window.__fixture.closeConnections();
    while (window.__zenRecorderPage?.snapshot().state === 'recording') {
      if (Date.now() - closedAt > 15_000) return null;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Date.now() - closedAt;
  });
  await waitFor(
    'the recording saved',
    async () => {
      const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
      return recordings.find((recording) => recording.id === id)?.status === 'saved';
    },
    20_000,
  );
  const ended = (await pageDiagnostics(page, since)).find((line) =>
    line.includes('recording ended ('),
  );
  if (!ended?.includes('(connections-lost)')) {
    problems.push(`a recording ended otherwise than by losing its connections: ${ended}`);
  }
  await page.close();
  return stoppedAfterMs;
}

export async function scenarioClosedConnections({ browser, target }: ScenarioContext) {
  console.log(
    `▶ ${target.id} scenario 83: the page closes the call's connections → the recording stops ${MAX_STOP_MS / 1000} s after at most, not at a later tick`,
  );
  const problems: string[] = [];
  const stops: (number | null)[] = [];
  for (let run = 0; run < TRIALS; run++) stops.push(await trial(browser, target, run, problems));
  const shown = stops.map((ms) => (ms === null ? 'never' : `${(ms / 1000).toFixed(2)} s`));
  console.log(`  stopped after the close: ${shown.join(', ')}`);
  if (stops.some((ms) => ms === null || ms > MAX_STOP_MS)) {
    problems.push(
      `stopped ${shown.join(', ')} after the close, expected ${MAX_STOP_MS} ms at most`,
    );
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}
