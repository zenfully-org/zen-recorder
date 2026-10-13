/**
 * E2e scenario 6, run against every provider's fixture page: the audio encoder fails mid-recording
 * → that file is saved and a new recording starts, whose chunks are stored while that file is still
 * being saved.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  expectEqual,
  failLastMediaRecorder,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  overlayState,
  pageDiagnostics,
  probe,
  sleep,
  storedRecordings,
  trackMediaRecorders,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

export async function scenarioEncoderErrorRestart({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 6: audio encoder error → file saved, recording restarts`);
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
    await sleep(5_000);
    // The failed file's save is held, as a long video's finalize takes its time (15 s for an hour
    // on an idle machine): the next recording's chunks must be stored meanwhile.
    await probe(page, 'save:hold-next');
    await failLastMediaRecorder(page, 'injected by the e2e run');
    const next = await waitFor(
      'a new recording after the encoder error',
      async () => {
        const id = await currentRecordingId(page);
        return id !== null && id !== first ? id : null;
      },
      15_000,
    ).finally(async () => {
      for (const line of await pageDiagnostics(page)) console.log(`  diagnostics: ${line}`);
    });
    const restartedAt = Date.now();
    expectEqual(await overlayState(page), 'recording', 'state after the encoder error');
    const recordings = () => storedRecordings(page);
    const stored = await waitFor(
      'the next recording stored while the failed file is saving',
      async () => {
        const all = await recordings();
        const failed = all.find((recording) => recording.id === first);
        const current = all.find((recording) => recording.id === next);
        return failed?.status === 'finalizing' && current && current.chunkCount > 0
          ? current
          : null;
      },
      12_000,
    ).finally(async () => {
      console.log(`  background, save held: ${JSON.stringify(await recordings())}`);
      // Page log lines go through the same tab queue as chunks.
      const lines = await pageDiagnostics(page);
      const since = lines.slice(lines.findIndex((line) => line.includes('encoder error')) + 1);
      for (const line of since) console.log(`  diagnostics, save held: ${line}`);
    });
    console.log(
      `  save of ${first} held (finalizing); ${next}: ${stored.chunkCount} chunk(s), ` +
        `${stored.byteSize} bytes stored within ${Date.now() - restartedAt} ms of the restart`,
    );
    await probe(page, 'save:release');
    await sleep(5_000);
    await page.evaluate(() => window.__fixture.hangup());
    const files = await waitFor(
      'two saved files',
      async () => {
        const saved = await newRecordings(before);
        return saved.length >= 2 ? saved : null;
      },
      60_000,
    );
    expectEqual(files.length, 2, 'files saved for one failure');
    for (const file of files) {
      const info = await inspectWebm(await waitForCompleteFile(file));
      console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
      if (info.tracks !== 1 || info.video) throw new Error('expected an audio-only file');
      if (!(info.durationS > 3)) throw new Error(`file too short: ${info.durationS} s`);
    }
  } finally {
    await probe(page, 'save:release');
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export const registration = {
  name: '6',
  after: '4',
  scenario: scenarioEncoderErrorRestart,
} satisfies ScenarioRegistration;
