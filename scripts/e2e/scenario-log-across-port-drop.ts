/**
 * E2e scenario 60, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * background drops the meeting tab's Port (as an event page restart does) and the recording is
 * stopped at once, so the page writes its "recording ended" line while the bridge has no Port: it
 * connects again a second later. The line still reaches the Diagnostics log, once, under the time
 * the bridge got it rather than the time it arrived, and the recording is saved.
 */
import { z } from 'zod';
import { currentRecordingId, expectEqual, openMeeting, probe, sleep, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const entriesSchema = z.array(
  z.object({ at: z.number(), level: z.string(), source: z.string(), message: z.string() }),
);
const disconnectedSchema = z.object({ disconnected: z.number() });
const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string() })),
});
/** The page's line for a recording stopped from the status card. */
const ENDED = 'recording ended (command)';
/** How long after the Stop the bridge may get the page's line. */
const STOP_TO_LINE_MS = 3_000;

export async function scenarioLogAcrossPortDrop({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 60: the background drops the Port as the recording stops → the page's "${ENDED}" line still reaches Diagnostics, once, at its own time`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  const since = Date.now();
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(4_000);
  const { disconnected } = disconnectedSchema.parse(await probe(page, 'ports:disconnect'));
  const stoppedAt = Date.now();
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  await waitFor(
    `${id} saved`,
    async () =>
      recordingsSchema
        .parse(await probe(page, 'background:state'))
        .recordings.some((recording) => recording.id === id && recording.status === 'saved'),
    60_000,
  );
  const endedLines = async () =>
    entriesSchema
      .parse(await probe(page, 'diagnostics'))
      .filter((entry) => entry.at >= since && entry.source.startsWith('page'))
      .filter((entry) => entry.message.startsWith(ENDED));
  // A line lost with the Port is sent again a few seconds later, on the new one.
  await waitFor(
    'the page line in Diagnostics',
    async () => (await endedLines()).length > 0,
    20_000,
  ).catch(() => false);
  // Long enough for a line sent again to show twice, if it were written twice.
  await sleep(6_000);
  const lines = await endedLines();
  console.log(`  ${disconnected} Port(s) dropped by the background, then Stop`);
  for (const line of lines) {
    const after = ((line.at - stoppedAt) / 1000).toFixed(2);
    console.log(
      `  diagnostics: ${new Date(line.at).toISOString()} (${after} s after Stop) ${line.message}`,
    );
  }
  expectEqual(lines.length, 1, `"${ENDED}" lines in Diagnostics`);
  const [line] = lines;
  if (line && (line.at < stoppedAt || line.at > stoppedAt + STOP_TO_LINE_MS)) {
    throw new Error(
      `the line is written under ${line.at - stoppedAt} ms after Stop, not its own time`,
    );
  }
  await page.close();
}
