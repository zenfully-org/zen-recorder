/**
 * E2e scenario 7, run against every provider's fixture page: the audio encoder fails while paused →
 * nothing records until Resume, then a new file.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  expectEqual,
  failLastMediaRecorder,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pageDiagnostics,
  pressCardButton,
  probe,
  sleep,
  trackMediaRecorders,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

/** How long the run stays paused after the encoder error before it presses Resume. */
const PAUSE_WINDOW_MS = 8_000;

/** How long the next recording runs after Resume: all its file may contain. */
const RESUMED_MS = 6_000;

export async function scenarioEncoderErrorWhilePaused({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 7: audio encoder error while paused → nothing records until Resume`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await trackMediaRecorders(page);
    await page.click('#start');
    const first = await waitFor('first recording', () => currentRecordingId(page), 20_000);
    await sleep(4_000);
    await pressCardButton(page, 'Pause');
    await waitFor('paused', async () => (await overlayState(page)) === 'paused', 5_000);
    await sleep(1_000);
    await failLastMediaRecorder(page, 'injected by the e2e run');
    const printDiagnostics = async () => {
      for (const line of await pageDiagnostics(page)) console.log(`  diagnostics: ${line}`);
    };
    await waitFor(
      'the failed recording to end',
      async () => (await currentRecordingId(page)) !== first,
      15_000,
    ).catch(async (error: unknown) => {
      await printDiagnostics();
      throw error;
    });
    const failedAt = Date.now();
    const firstFile = await waitForNewRecording(before);
    await printDiagnostics();
    // Read once the failed file is saved: the overlay has left "Saving…" by then.
    const afterError = await overlayState(page);
    console.log(`  state once the failed file is saved: ${afterError}`);
    await sleep(Math.max(0, failedAt + PAUSE_WINDOW_MS - Date.now()));
    const beforeResume = await overlayState(page);
    const idWhilePaused = await currentRecordingId(page);
    // The failed recorder is the first one; any other was started during the pause.
    const recordersWhilePaused = await page.evaluate(
      () => (window.__e2eRecorders?.length ?? 1) - 1,
    );
    const resumed = await page.evaluate(() => window.__fixture.clickOverlay('Resume'));
    const pausedS = ((Date.now() - failedAt) / 1000).toFixed(1);
    console.log(
      `  ${pausedS} s later: state ${beforeResume}, recording ${idWhilePaused ?? 'none'}, ${recordersWhilePaused} MediaRecorder(s) started since the error; Resume ${resumed ? 'pressed' : 'not shown'}`,
    );
    await sleep(RESUMED_MS);
    // Stop ends the file at once (a hangup can add the connection-loss grace).
    await pressCardButton(page, 'Stop');
    const restartedFile = await waitForNewRecording(before, (file) => file !== firstFile);
    for (const [label, file] of [
      ['failed', firstFile],
      ['next', restartedFile],
    ] as const) {
      console.log(
        `  ${label} file: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`,
      );
      console.log(`    ffprobe: ${ffprobe(file)}`);
    }
    expectEqual(afterError, 'paused', 'state once the failed file is saved');
    expectEqual(beforeResume, 'paused', 'state at the end of the pause');
    expectEqual(idWhilePaused, null, 'recording running while paused');
    expectEqual(recordersWhilePaused, 0, 'MediaRecorders started while paused');
    if (!resumed) throw new Error('the overlay had no Resume button after the encoder error');
    // The file holds what was recorded after Resume, never the pause before it.
    const { durationS } = await inspectWebm(restartedFile);
    const resumedS = RESUMED_MS / 1000;
    if (!(durationS > resumedS - 2 && durationS < resumedS + 1.5)) {
      throw new Error(
        `next file is ${durationS.toFixed(1)} s: expected about ${resumedS} s (the part after Resume), not the ${PAUSE_WINDOW_MS / 1000} s pause before it`,
      );
    }
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export const registration = {
  name: '7',
  after: '81',
  scenario: scenarioEncoderErrorWhilePaused,
} satisfies ScenarioRegistration;
