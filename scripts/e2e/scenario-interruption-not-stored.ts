/**
 * E2e scenario 10, run against every provider's fixture page: the store fails while two crashed
 * tabs are interrupted, and again in the recovery pass of a fresh background → every failure is in
 * Diagnostics, the pass goes on, both files saved.
 *
 * The run waits for the recordings to turn stale against a test build's timings
 * (`TEST_BUILD_TIMINGS`): the pass 10 s after a start, a recording abandoned 20 s after its last
 * chunk.
 */
import path from 'node:path';
import { z } from 'zod';
import { TEST_BUILD_TIMINGS as TIMINGS } from '@/wiring/test-build-timings';
import { dieLikeACrash } from './die-like-a-crash';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  storedRecordings,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { reloadExtension } from './reload-extension';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

const backgroundStateSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), error: z.string().nullish() }),
  ),
});

const recoveredFiles = async (before: ReadonlySet<string>): Promise<string[]> =>
  (await newRecordings(before)).filter((file) => file.includes('(recovered)'));

export async function scenarioInterruptionNotStored({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 10: the store fails in the interruption and the recovery pass → logged, both files saved`,
  );
  const before = new Set(await listWebm());
  const startedAt = new Date().toISOString().slice(11, 23);
  const tabs = [
    await openMeeting(browser, meetingUrl(target)),
    await openMeeting(browser, meetingUrl(target)),
  ];
  // Not joined, so it records nothing: it arms the faults and reads the background's state.
  let control = await openMeeting(browser, meetingUrl(target));
  const ids: string[] = [];
  const recordings = async () =>
    backgroundStateSchema
      .parse(await probe(control, 'background:state'))
      .recordings.filter((recording) => ids.includes(recording.id));
  const linesOf = async (needle: string) =>
    (await backgroundDiagnostics(control)).filter(
      (line) => line.includes(needle) && ids.some((id) => line.includes(id)),
    );
  const report = async () => {
    console.log(`  recordings: ${JSON.stringify(await recordings())}`);
    // The `saved` lines name the file, not the recording. Lines start with their UTC time.
    for (const line of (await backgroundDiagnostics(control)).filter(
      (l) =>
        ids.some((id) => l.includes(id)) ||
        (l.includes('(recovered)') && l.slice(0, 12) >= startedAt),
    )) {
      console.log(`  diagnostics: ${line}`);
    }
  };
  try {
    const result = videoModeSchema.safeParse(await probe(control, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    for (const page of tabs) {
      // In front while it joins: Firefox defers device enumeration in a background tab.
      await page.bringToFront();
      await page.click('#start');
      ids.push(await waitFor('recording', () => currentRecordingId(page), 20_000));
    }
    const chunks = async () =>
      (await storedRecordings(control)).filter(
        (recording) => ids.includes(recording.id) && recording.chunkCount > 1,
      );
    await waitFor(
      'two chunks of each recording stored',
      async () => (await chunks()).length === 2,
      20_000,
    );
    // Both interruptions, 10 s after their tab died, fail to store `interrupted`.
    for (const _ of ids) await probe(control, 'store:fail-next-interruption');
    for (const page of tabs) {
      await dieLikeACrash(page);
      await page.close();
    }
    const closedAt = Date.now();
    console.log(
      `  both recording tabs died without a pagehide end, the next ${ids.length} interruptions fail`,
    );
    await waitFor(
      'both failed interruptions in Diagnostics',
      async () => (await linesOf('could not interrupt')).length === ids.length,
      30_000,
    ).catch(async (error: unknown) => {
      await report();
      throw error;
    });
    // Nothing is lost: the chunks stay, and the next recovery pass takes them.
    for (const recording of await recordings()) {
      expectEqual(recording.status, 'recording', `${recording.id} after its failed interruption`);
    }
    // A fresh background's recovery pass (`recoveryDelayMs` after it starts) takes a recording
    // only once it is abandoned, `abandonedAfterMs` after its last chunk: reload once the pass
    // will find both stale, 5 s to spare. Probing meanwhile keeps the event page from being
    // suspended.
    await waitFor(
      'the recordings to turn stale',
      async () => {
        await probe(control, 'background:state');
        return Date.now() > closedAt + TIMINGS.abandonedAfterMs - TIMINGS.recoveryDelayMs + 5_000;
      },
      45_000,
    );
    await control.close();
    control = await reloadExtension(browser, target);
    await probe(control, 'store:fail-next-interruption');
    console.log('  extension reloaded, the next interruption fails (the recovery pass)');
    const failed = await waitFor(
      'a failed recovery in Diagnostics',
      async () => (await linesOf('could not recover')).at(0),
      60_000,
    ).catch(async (error: unknown) => {
      await report();
      throw error;
    });
    // The pass went on: the other recording is saved.
    const saved = await waitFor(
      'the other recording saved',
      async () => (await recordings()).find((recording) => recording.status === 'saved'),
      60_000,
    ).catch(async (error: unknown) => {
      await report();
      throw error;
    });
    if (failed.includes(saved.id)) throw new Error(`${saved.id} was saved and failed`);
    // The next background start saves the one that failed.
    await control.close();
    control = await reloadExtension(browser, target);
    console.log('  extension reloaded again');
    await waitFor(
      'both recordings saved',
      async () => {
        const saved = (await recordings()).filter((recording) => recording.status === 'saved');
        return saved.length === ids.length && (await recoveredFiles(before)).length === ids.length;
      },
      60_000,
    ).catch(async (error: unknown) => {
      await report();
      throw error;
    });
    await report();
    for (const file of await recoveredFiles(before)) {
      const info = await inspectWebm(await waitForCompleteFile(file));
      console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
      console.log(`    ffprobe: ${ffprobe(file)}`);
      if (!(info.durationS > 3)) throw new Error(`file too short: ${info.durationS} s`);
    }
  } finally {
    if (!control.isClosed()) await probe(control, 'settings:video-on');
  }
  await control.close();
}

export const registration = {
  name: '10',
  // Last: it reloads the extension twice.
  after: '25',
  scenario: scenarioInterruptionNotStored,
} satisfies ScenarioRegistration;
