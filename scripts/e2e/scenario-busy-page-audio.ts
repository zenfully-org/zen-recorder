/**
 * E2e scenario 72, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * meeting page runs 100 ms tasks back to back while it records → the audio worklet's buffers keep
 * reaching the page as fast as they are captured, a Stop pressed during the load ends the
 * recording within a few seconds, and the file holds the whole audio. Gecko hands the page a
 * MessagePort's messages one per task, so a page busy with 100 ms tasks took at most ten of the
 * worklet's 23 buffers a second: the backlog grew for as long as the load lasted, and the Stop,
 * which waits for every buffer captured before it, waited for all of it.
 *
 * The load queues each task behind the last through a MessageChannel: a chain of `setTimeout(0)`
 * leaves 4 ms between tasks (Firefox clamps nested timeouts), in which the page catches up.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** How long the page runs its long tasks, and when in that time Stop is pressed. */
const LOAD_MS = 30_000;
const STOP_AFTER_MS = 22_000;
/** Seconds of audio the page must receive per second of the load (one buffer per task: 0.43). */
const MIN_AUDIO_RATE = 0.9;
/** The Stop may take this long under the load; the backlog of 22 s took far longer. */
const MAX_STOP_S = 5;

const diagnosticsSchema = z.array(
  z.object({ at: z.number(), source: z.string(), message: z.string() }),
);
const receivedSchema = z.object({ at: z.number(), frames: z.number(), rate: z.number() });

// Passed as strings: the page runs them, not this process (no helpers of the bundler in them).
/** Counts what the tap's worklet hands the page: wraps the constructor the recorder will use. */
const COUNT_TAP = `(() => {
  const Original = window.AudioWorkletNode;
  window.__tapReceived = { frames: 0, rate: 48000 };
  window.AudioWorkletNode = function (context, name, options) {
    const node = new Original(context, name, options);
    window.__tapReceived.rate = context.sampleRate;
    node.port.addEventListener('message', (event) => {
      if (event.data && event.data.samples) window.__tapReceived.frames += event.data.samples.length;
    });
    return node;
  };
})()`;
const RECEIVED = `({ at: performance.now(), ...window.__tapReceived })`;
const LOAD = `(() => {
  const until = Date.now() + ${LOAD_MS};
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const end = Date.now() + 100;
    while (Date.now() < end) {}
    if (Date.now() < until) channel.port2.postMessage(0);
  };
  channel.port2.postMessage(0);
})()`;

export async function scenarioBusyPageAudio({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 72: the page runs 100 ms tasks back to back → the worklet's audio keeps up, and Stop ends the recording at once, with all its audio`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  // Not in the call: it reads the Diagnostics while the meeting page is busy.
  const control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await page.evaluate(COUNT_TAP);
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(2_000);
  const startedAt = Date.now();
  await page.evaluate(LOAD);
  await sleep(5_000);
  const first = receivedSchema.parse(await page.evaluate(RECEIVED));
  await sleep(STOP_AFTER_MS - 5_000);
  const second = receivedSchema.parse(await page.evaluate(RECEIVED));
  const audioRate = (second.frames - first.frames) / second.rate / ((second.at - first.at) / 1000);
  console.log(
    `  under the load the page received ${audioRate.toFixed(2)} s of audio per second (${(second.frames / second.rate).toFixed(1)} s in all)`,
  );
  const clickedAt = Date.now();
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const ended = await waitFor(
    'the recording ended',
    async () => {
      const lines = diagnosticsSchema.parse(await probe(control, 'diagnostics'));
      return lines.find((line) => line.at >= clickedAt && line.message.includes('recording ended'));
    },
    LOAD_MS + 30_000,
  );
  const stopS = (ended.at - clickedAt) / 1000;
  console.log(`  ${ended.message}: ${stopS.toFixed(1)} s after Stop, the load still running`);
  const [file] = await waitFor(
    'the saved file',
    async () => {
      const saved = await newRecordings(before);
      return saved.length > 0 ? saved : null;
    },
    60_000,
  );
  if (!file) throw new Error(`no file for ${id}`);
  const info = await inspectWebm(await waitForCompleteFile(file));
  console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
  const problems: string[] = [];
  // A page whose policy refuses the worklet's blob module records through a ScriptProcessor,
  // whose buffers no message port carries (Teams).
  const lines = diagnosticsSchema.parse(await probe(control, 'diagnostics'));
  const processor = lines.some(
    (line) => line.at >= since && line.message === 'audio tap: processor',
  );
  if (processor) console.log('  the page records through its ScriptProcessor: no worklet to count');
  else if (audioRate < MIN_AUDIO_RATE) {
    problems.push(`the page received ${audioRate.toFixed(2)} s of audio per second under the load`);
  }
  if (stopS > MAX_STOP_S) problems.push(`Stop took ${stopS.toFixed(1)} s under the load`);
  // Everything recorded up to the click is in the file, the load included.
  const recordedS = (clickedAt - startedAt) / 1000 + 2;
  if (info.durationS < recordedS - 1) {
    problems.push(
      `the file lasts ${info.durationS.toFixed(1)} s, the page recorded ${recordedS.toFixed(1)} s`,
    );
  }
  await page.close();
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
