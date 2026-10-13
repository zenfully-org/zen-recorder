/**
 * E2e scenario 12, run against every provider's fixture page: Record and Stop at once with video
 * on, before the first frame or audio sample → no file, and "nothing was recorded" in Diagnostics
 * and in the stored recording.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { recordAndStopAtOnce, STOP_AT_ONCE_ATTEMPTS } from './record-and-stop-at-once';
import { meetingUrl } from './targets';
import { waitForFinalized } from './wait-for-finalized';

const videoModeSchema = z.object({ videoMode: z.string() });

/** What finalize stores and logs for a recording that has no audio or video sample. */
const NOTHING_RECORDED =
  'nothing was recorded (stopped before the first audio or video sample); no file saved';

export async function scenarioStopBeforeFirstSample({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 12: Record and Stop at once with video on → no unplayable file`,
  );
  for (let attempt = 1; attempt <= STOP_AT_ONCE_ATTEMPTS; attempt++) {
    // A fresh page each time: Record then lands while the video encoder probe runs, so the start
    // waits for it and the overlay already shows Stop when the recording gets its id.
    const page = await openMeeting(browser, meetingUrl(target));
    try {
      const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
      if (!result.success || result.data.videoMode !== 'tiles') {
        throw new Error('could not switch video on through the debug probe');
      }
      const before = new Set(await listWebm());
      const since = new Date().toISOString().slice(11, 23);
      const id = await recordAndStopAtOnce(page);
      const [recording] = await waitForFinalized(page, [id]);
      if (!recording) throw new Error(`recording ${id} not finalized`);
      console.log(`  ${id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}`);
      // Lines start with their UTC time: only the ones written since Record.
      const lines = (await backgroundDiagnostics(page)).filter(
        (line) => line.slice(0, 12) >= since,
      );
      for (const line of lines) console.log(`  diagnostics: ${line}`);
      await sleep(1_000);
      const files = await newRecordings(before);
      let playable = true;
      for (const file of files) {
        const info = await inspectWebm(await waitForCompleteFile(file));
        console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
        console.log(`    ffprobe: ${ffprobe(file)}`);
        playable &&= info.tracks > 0 && info.durationS > 0;
      }
      if (!playable) throw new Error('a file with no audio or video was saved');
      if (recording.status === 'saved') {
        // Not a failure: a frame or an audio sample got in before the Stop, and the file plays.
        console.log(`  attempt ${attempt}: a sample was recorded before the Stop`);
        continue;
      }
      expectEqual(recording.error, NOTHING_RECORDED, `reason stored for ${id}`);
      expectEqual(files.length, 0, `files saved for ${id}`);
      if (!lines.some((line) => line.includes(`finalize ${id} failed: ${NOTHING_RECORDED}`))) {
        throw new Error('no "nothing was recorded" line in Diagnostics');
      }
      return;
    } finally {
      await page.close();
    }
  }
  throw new Error(`every Stop came after the first sample (${STOP_AT_ONCE_ATTEMPTS} attempts)`);
}

export const registration = {
  name: '12',
  after: '65',
  scenario: scenarioStopBeforeFirstSample,
} satisfies ScenarioRegistration;
