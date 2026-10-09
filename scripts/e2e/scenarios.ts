/**
 * The end-to-end scenarios, written once and run against every provider's fixture page (see the
 * fixture contract in `harness.ts`). Each one is a bug that must not come back or a feature every
 * provider has to have:
 *   1. auto-record with video while the tab is covered, a screen share, mute, stop on hangup;
 *      in front, hidden and sharing, the file holds the frames the recorder aimed for, unless it
 *      measured itself overloaded (a busy machine lowers the rate, a stalled tab does not),
 *   2. a tab that dies mid-recording without its `pagehide` end (a crash) → a "(recovered)" file,
 *   3. Record button while alone, then join, then stop,
 *   4. video switched off → audio-only file,
 *   5. extension reloaded mid-recording → one complete file, nothing duplicated or recovered,
 *   6. the audio encoder fails mid-recording → that file is saved and a new recording starts,
 *      whose chunks are stored while that file is still being saved,
 *   7. the audio encoder fails while paused → nothing records until Resume, then a new file,
 *   8. two tabs of one meeting stopped at once (same file name, a name new on disk) → two files,
 *   9. the background fails to store one chunk → the page sends it again, one complete file,
 *  10. the store fails while two crashed tabs are interrupted, and again in the recovery pass of a
 *      fresh background → every failure is in Diagnostics, the pass goes on, both files saved,
 *  11. a meeting title Firefox refuses as a file name, then a name Firefox refuses anyway → each
 *      recording saved as one file, the second under the dated fallback name,
 *  12. Record and Stop at once with video on, before the first frame or audio sample → no file,
 *      and "nothing was recorded" in Diagnostics and in the stored recording,
 *  13. the page stops a microphone, which fires no event (Teams' permission probe on load, a
 *      microphone test next to the call's microphone) → no microphone named before joining, and
 *      the call's microphone recorded after the test as loud as before it,
 *  14. the page is busy right before Pause and right before Stop → the audio still queued for
 *      the page is kept: no gap after Resume, and the file's audio reaches the Stop,
 *  15. the Port drops while the recording stops, as when the event page restarts → the page
 *      sends the end again, and the file is saved at once under its own name, not "(recovered)",
 *  16. the page stays busy for seconds, so the audio reaches it late the whole time → no silence
 *      is inserted, and the file's audio is as long as the recording,
 *  17. the host alone in the meeting, a guest knocks (fake pages with a host side: Zoom, whose
 *      counter counts the waiting room) → nothing records until the guest is let in,
 *  20. the meeting page goes away while it records: a navigation right after leaving, before the
 *      stop is done, then a closed tab → each file saved within seconds under its own name, not
 *      "(recovered)",
 *  22. the built manifest's description ends with the independence notice, and the Options page
 *      footer shows the version and the full notice,
 *  25. a tab dies (a crash) while a chunk it delivered is still being stored, so the chunk is
 *      stored after its Port dropped → the background still takes the recording once its grace
 *      is over, and the "(recovered)" file holds that chunk,
 *  33. the extension takes no chunk for a long time (a full disk, a store that hangs) → the
 *      recording with video stops once the page holds its limit, the rest records audio only at
 *      once, and when the extension is back both files are saved whole, no chunk dropped,
 *  35. the first recording in a freshly opened meeting page, which has no audio stream open yet
 *      → the file has the page's audio from its first moment, not a second of silence while the
 *      browser opens the audio device,
 *  37. the video encoder fails while the extension takes no chunk → the audio-only recording
 *      starts at once, beside the failed recording's chunks still waiting in the page, and when
 *      the extension is back both files are saved whole,
 *  38. the store answers a chunk after the bridge's ack timeout, so the page sends it again → the
 *      chunks and bytes counted while recording are those joined into the file; then chunks of
 *      recordings that were never stored, one set a day old and one just stored → the next
 *      background start deletes the old set and keeps the new one.
 */
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { z } from 'zod';
import { getProjectTexts } from '../../src/lib/project/get-project-texts';
import { readVideoTimeline } from '../bench/read-video-timeline';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  builtManifest,
  currentRecordingId,
  describeWebm,
  dropPortOnNextEnd,
  EXTENSION_DIR,
  expectEqual,
  failLastMediaRecorder,
  failVideoEncoder,
  ffprobe,
  inspectWebm,
  levelsOverTime,
  listWebm,
  meanVolume,
  newRecordings,
  openMeeting,
  overlayState,
  pageDiagnostics,
  probe,
  recordingStarted,
  recordingStartedAt,
  sampleVideoStats,
  silences,
  sleep,
  storedRecording,
  toneLevel,
  trackEnds,
  trackMediaRecorders,
  waitFor,
  waitForCompleteFile,
  waitForNewRecording,
} from './harness';
import { judgeFrameSpan, type VideoStatsSample } from './judge-frame-span';
import { type FixtureTarget, meetingUrl } from './targets';

export interface ScenarioContext {
  browser: Browser;
  target: FixtureTarget;
}

const videoModeSchema = z.object({ videoMode: z.string() });
const recordingStateSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), chunkCount: z.number(), byteSize: z.number() }),
  ),
});

/** The right provider must own the page: the snapshot says which one is recording it. */
export async function scenarioProviderRouting({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id}: the ${target.label} provider owns the fixture page`);
  const page = await openMeeting(browser, meetingUrl(target));
  const provider = await page.evaluate(() => window.__zenRecorderPage?.snapshot().provider);
  expectEqual(provider, target.id, 'provider recording this page');
  const overlays = await page.evaluate(
    () => document.querySelectorAll('zen-recorder-overlay').length,
  );
  expectEqual(overlays, 1, 'overlays mounted (one bridge per page)');
  console.log(`  opfs probe: ${JSON.stringify(await probe(page, 'opfs'))}`);
  await page.close();
}

export async function scenarioAutoRecordAndHangup({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 1: auto-record (audio + video tiles), hidden tab, share, stop on hangup`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start'); // a real click: gives the page user activation like "Join now" does
  await waitFor('recording state', async () => (await overlayState(page)) === 'recording', 20_000);
  console.log('  recording started');
  await waitFor(
    `${target.tiles.call} tiles`,
    async () => (await page.evaluate(() => window.__fixture.tileCount())) === target.tiles.call,
    10_000,
  );
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  // The recorder's statistics at the ends of each phase: its frames are judged phase by phase.
  const inFront = { from: await sampleVideoStats(page), to: await sleepAndSample(page, 4_000) };
  // Cover the meeting tab for a while: the compositor must keep producing frames while hidden.
  const cover = await browser.newPage();
  await cover.goto('about:blank');
  const hidden = { from: await sampleVideoStats(page), to: await sleepAndSample(page, 6_000) };
  await cover.close();
  await page.bringToFront();
  const backInFront = await sampleVideoStats(page);
  await page.evaluate(() => window.__fixture.toggleShare());
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.mute());
  await sleep(2_000);
  await page.evaluate(() => window.__fixture.unmute());
  const sharing = { from: backInFront, to: await sleepAndSample(page, 2_000) };
  const overlay = await page.evaluate(() => window.__fixture.overlayState()?.text ?? '');
  if (!overlay.includes(`${target.tiles.sharing} tiles`)) {
    throw new Error(`overlay should show ${target.tiles.sharing} video tiles, got "${overlay}"`);
  }
  await page.evaluate(() => window.__fixture.hangup());
  await waitFor(
    'recorder stopped',
    async () => {
      const state = await overlayState(page);
      return state === 'idle' || state === 'waiting';
    },
    30_000,
  );
  const file = await waitForNewRecording(before);
  await sleep(2_000);
  for (const saved of await newRecordings(before)) {
    console.log(`  file: ${path.basename(saved)} → ${describeWebm(await inspectWebm(saved))}`);
    console.log(`    ffprobe: ${ffprobe(saved)}`);
  }
  const info = await inspectWebm(file);
  if (info.bytes < 100_000) throw new Error('file suspiciously small');
  if (!(info.durationS > 15 && info.durationS < 60)) {
    throw new Error(`unexpected duration ${info.durationS}`);
  }
  if (info.tracks !== 2) throw new Error(`expected audio + video tracks, got ${info.tracks}`);
  const video = info.video;
  if (!video) throw new Error('expected a video track');
  if (video.codec !== 'vp9') throw new Error(`expected VP9, got ${video.codec}`);
  if (video.width !== 1920 || video.height !== 1080) {
    throw new Error(`expected 1920x1080, got ${video.width}x${video.height}`);
  }
  // The fixture tiles change every frame, so every phase, hidden too, must hold frames at the rate
  // the recorder aimed for, unless the machine was too busy for it (see `judgeFrameSpan`).
  const frameTimes = (await readVideoTimeline(file, info.bytes)).frames.map((frame) => frame.t);
  const phases = { 'in front': inFront, hidden, 'in front, sharing': sharing };
  const verdicts = Object.entries(phases).map(([label, span]) =>
    judgeFrameSpan({ label, ...span, startedAt, frameTimes }),
  );
  for (const { summary } of verdicts) console.log(`  frames: ${summary}`);
  const stalled = verdicts.filter((span) => span.verdict === 'stalled');
  if (stalled.length > 0) {
    const spans = stalled.map((span) => span.summary).join('; ');
    throw new Error(`too few video frames, with no load to explain it (tab stalled?): ${spans}`);
  }
  await page.close();
}

async function sleepAndSample(page: Page, ms: number): Promise<VideoStatsSample> {
  await sleep(ms);
  return sampleVideoStats(page);
}

export async function scenarioRecordAlone({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 3: Record button while alone (no call yet), join, stop`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  expectEqual(await overlayState(page), 'idle', 'state before anything happens');
  await page.evaluate(() => window.__fixture.clickOverlay('Record'));
  await waitFor('recording alone', async () => (await overlayState(page)) === 'recording', 10_000);
  await sleep(6_000);
  expectEqual(await overlayState(page), 'recording', 'state while alone after 6 s');
  await page.click('#start');
  await sleep(4_000);
  expectEqual(await overlayState(page), 'recording', 'state after joining');
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  // 6 s alone + 4 s in the call; Record is clicked right after page load, so the start may wait
  // up to 2 s for the encoder probe. The time alone has no audio source at all: the file must
  // still cover it (the mixer's keep-alive source and the audio clock repair guarantee that).
  if (!(info.durationS > 7.5)) throw new Error(`alone recording too short: ${info.durationS}`);
  await page.close();
}

export async function scenarioAudioOnly({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 4: video switched off → audio-only file`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.click('#start');
    await waitFor(
      'recording state',
      async () => (await overlayState(page)) === 'recording',
      20_000,
    );
    await sleep(6_000);
    await page.evaluate(() => window.__fixture.hangup());
    const file = await waitForNewRecording(before);
    const info = await inspectWebm(file);
    console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
    if (info.tracks !== 1 || info.video) throw new Error('expected an audio-only file');
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

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
    const recordings = async () =>
      recordingStateSchema.parse(await probe(page, 'background:state')).recordings;
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
    await page.evaluate(() => window.__fixture.clickOverlay('Pause'));
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
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
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

const backgroundStateSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), error: z.string().nullish() }),
  ),
});

/** `YYYY-MM-DD_HH-MM` in local time: how the default template names a recording's start minute. */
function minuteStamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/**
 * Waits for a minute that has no saved file yet and at least `secondsNeeded` left, and returns
 * its stamp. Firefox uniquifies a name that is already on disk; the race only hits a new name.
 */
async function waitForFreshMinute(secondsNeeded: number): Promise<string> {
  for (;;) {
    const now = new Date();
    const stamp = minuteStamp(now);
    const taken = (await listWebm()).some((file) => path.basename(file).startsWith(stamp));
    if (!taken && 60 - now.getSeconds() >= secondsNeeded) return stamp;
    await sleep((60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 500);
  }
}

/** Waits until the background has saved, or given up on, every recording in `ids`. */
export async function waitForFinalized(page: Page, ids: string[]) {
  return waitFor(
    'recordings finalized',
    async () => {
      const state = backgroundStateSchema.parse(await probe(page, 'background:state'));
      const done = state.recordings.filter(
        (recording) =>
          ids.includes(recording.id) &&
          (recording.status === 'saved' || recording.status === 'failed'),
      );
      return done.length === ids.length ? done : null;
    },
    60_000,
  );
}

export async function scenarioSameNameAtOnce({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 8: two recordings with the same name finalized at once → two files`,
  );
  const before = new Set(await listWebm());
  const pages = [
    await openMeeting(browser, meetingUrl(target)),
    await openMeeting(browser, meetingUrl(target)),
  ];
  const [first] = pages;
  if (!first) throw new Error('no page');
  try {
    const result = videoModeSchema.safeParse(await probe(first, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    // Two tabs of one meeting started in one minute render the same file name.
    const minute = await waitForFreshMinute(40);
    const ids: string[] = [];
    for (const page of pages) {
      // In front while it joins: Firefox defers device enumeration in a background tab.
      await page.bringToFront();
      await page.click('#start');
      ids.push(await waitFor('recording', () => currentRecordingId(page), 20_000));
    }
    if (minuteStamp(new Date()) !== minute) {
      throw new Error(`the recordings did not both start in ${minute}: their names differ`);
    }
    await sleep(5_000);
    const stoppedAt = new Date().toISOString().slice(11, 23);
    await Promise.all(
      pages.map((page) => page.evaluate(() => window.__fixture.clickOverlay('Stop'))),
    );
    console.log(`  Stop pressed in both tabs at ${stoppedAt}`);
    const finished = await waitForFinalized(first, ids);
    for (const recording of finished) {
      console.log(
        `  ${recording.id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}`,
      );
    }
    // Lines start with their UTC time, so sorting puts the two tabs' lines in order.
    const background = (await backgroundDiagnostics(first)).filter(
      (line) => line.includes(minute) || ids.some((id) => line.includes(id)),
    );
    const ended = (await pageDiagnostics(first)).filter(
      (line) => line.includes('recording ended') && line.slice(0, 12) >= stoppedAt,
    );
    for (const line of [...background, ...ended].sort()) console.log(`  diagnostics: ${line}`);
    await sleep(2_000);
    const files = await newRecordings(before);
    for (const file of files) {
      const info = await inspectWebm(await waitForCompleteFile(file));
      console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
      console.log(`    ffprobe: ${ffprobe(file)}`);
      if (!(info.durationS > 3)) throw new Error(`file too short: ${info.durationS} s`);
    }
    // Shortest first: `name.webm`, then the uniquified `name(1).webm`.
    const names = files.map((file) => path.basename(file)).sort((a, b) => a.length - b.length);
    expectEqual(names.length, 2, `files saved for two recordings started at ${minute}`);
    const [plain, numbered] = names;
    expectEqual(numbered, plain?.replace(/\.webm$/, '(1).webm'), 'name of the second file');
    for (const recording of finished) expectEqual(recording.status, 'saved', recording.id);
  } finally {
    await probe(first, 'settings:video-on');
  }
  for (const page of pages) await page.close();
}

export async function scenarioChunkNotStored({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 9: one chunk fails to store → sent again, one complete file`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const stored = () => storedRecording(page, id);
    // Once the header chunk is stored, so the chunk that fails is one in the middle of the file.
    await waitFor('the first chunk stored', async () => (await stored())?.chunkCount, 15_000);
    console.log(
      `  fail the next chunk: ${JSON.stringify(await probe(page, 'store:fail-next-chunk'))}`,
    );
    // A chunk without an ack is sent again once the bridge's 10 s ack timeout has passed.
    await sleep(16_000);
    console.log(`  before Stop: ${JSON.stringify(await stored())}`);
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    const linesOf = async (file?: string) =>
      (await backgroundDiagnostics(page)).filter(
        (line) => line.includes(id) || (file !== undefined && line.includes(path.basename(file))),
      );
    const file = await waitForNewRecording(before).catch(async (error: unknown) => {
      console.log(`  60 s after Stop: ${JSON.stringify(await stored())}`);
      for (const line of await linesOf()) console.log(`  diagnostics: ${line}`);
      throw error;
    });
    // The background logs the save once the recording is marked saved, a moment after the file.
    await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
    const lines = await linesOf(file);
    const ended = (await pageDiagnostics(page)).filter((line) => line.includes('recording ended'));
    for (const line of [...lines, ...ended.slice(-1)].sort()) console.log(`  diagnostics: ${line}`);
    const info = await inspectWebm(file);
    console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
    if (!lines.some((line) => line.includes('could not handle chunk'))) {
      throw new Error('no chunk failed: the injected store failure did not happen');
    }
    const gap = lines.find((line) => line.includes('chunk sequence gap'));
    if (gap) throw new Error(`a chunk is missing from the file: ${gap}`);
    // Every chunk the page recorded is in the file: the one that failed was stored when resent.
    const sent = ended.at(-1)?.match(/after (\d+) chunks/)?.[1];
    if (sent === undefined) throw new Error('the page logged no "recording ended" line');
    const saved = lines.map((line) => line.match(/^\S+ info: saved .* \((\d+) chunks/)?.[1]);
    expectEqual(saved.find(Boolean), sent, 'chunks in the file (the page recorded)');
    if (!(info.durationS > 10)) throw new Error(`file too short: ${info.durationS} s`);
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export async function scenarioExtensionReload({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 5: extension reloaded mid-recording → one complete file, nothing recovered`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  await waitFor('recording state', async () => (await overlayState(page)) === 'recording', 20_000);
  await sleep(5_000);
  // Same as "Reload" in about:debugging: the background and content scripts restart, but the
  // MAIN-world recorder keeps running inside the page.
  await browser.installExtension(EXTENSION_DIR);
  console.log('  extension reloaded while recording');
  await sleep(40_000); // longer than the recovery alarm (30 s) of the fresh background
  const overlays = await page.evaluate(
    () => document.querySelectorAll('zen-recorder-overlay').length,
  );
  expectEqual(overlays, 1, 'overlays after reload');
  expectEqual(await overlayState(page), 'recording', 'state after reload');
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  await sleep(5_000);
  const fresh = (await listWebm()).filter((saved) => !before.has(saved));
  for (const saved of fresh) {
    console.log(`  file: ${path.basename(saved)} → ${describeWebm(await inspectWebm(saved))}`);
  }
  expectEqual(fresh.length, 1, 'files saved by a recording that survived a reload');
  const info = await inspectWebm(file);
  if (info.tracks !== 2) throw new Error(`expected 2 tracks, got ${info.tracks}`);
  if (!(info.durationS > 40)) throw new Error(`recording was cut short: ${info.durationS} s`);
  await page.close();
}

export async function scenarioRecoveryOnTabClose({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 2: the tab dies mid-recording (a crash) → recovered file`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.evaluate(() => window.__fixture.start());
  const id = await waitFor('recording started', () => currentRecordingId(page), 20_000);
  // Two chunks, not a fixed wait: a 6 s sleep raced the second 3 s chunk and sometimes left one.
  await waitFor(
    'two chunks stored',
    async () =>
      (recordingStateSchema
        .parse(await probe(page, 'background:state'))
        .recordings.find((recording) => recording.id === id)?.chunkCount ?? 0) > 1,
    20_000,
  );
  await dieLikeACrash(page);
  await page.close();
  const recovered = await waitForNewRecording(before, (file) => file.includes('(recovered)'));
  const info = await inspectWebm(recovered);
  console.log(`  recovered: ${path.basename(recovered)} → ${describeWebm(info)}`);
  console.log(`    ffprobe: ${ffprobe(recovered)}`);
  if (!Number.isFinite(info.durationS)) throw new Error('recovered file has no duration');
  if (!(info.durationS > 3)) throw new Error(`recovered duration too short: ${info.durationS}`);
}

/**
 * A closed tab's bridge ends its recordings on `pagehide`. A crashed or killed tab gets no
 * `pagehide`: this makes the next close of `page` look like one, so the background's grace
 * interruption and recovery pass take the recording.
 */
export async function dieLikeACrash(page: Page): Promise<void> {
  const answer = z
    .object({ endOnPageHide: z.literal(false) })
    .safeParse(await probe(page, 'bridge:no-pagehide-end'));
  if (!answer.success) throw new Error('could not turn off the pagehide end of the bridge');
}

const recoveredFiles = async (before: ReadonlySet<string>): Promise<string[]> =>
  (await newRecordings(before)).filter((file) => file.includes('(recovered)'));

const heldChunksSchema = z.object({ held: z.number() });
const releasedChunksSchema = z.object({ released: z.number() });

export async function scenarioCrashWhileChunkStored({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 25: a tab dies while a chunk it delivered is still being stored → recovered with that chunk`,
  );
  const before = new Set(await listWebm());
  const since = new Date().toISOString().slice(11, 23);
  // Not in the call: it holds and releases the store, and reads the background's state.
  const control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const stored = () => storedRecording(control, id);
  await waitFor('two chunks stored', async () => ((await stored())?.chunkCount ?? 0) > 1, 20_000);
  await dieLikeACrash(page);
  // A busy store: the next chunk the tab delivers is stored only once the probe releases it.
  await probe(control, 'store:hold-next-chunk');
  await waitFor(
    'a chunk held in the store',
    async () => heldChunksSchema.parse(await probe(control, 'store:held-chunks')).held > 0,
    10_000,
  );
  const storedBefore = (await stored())?.chunkCount ?? 0;
  await page.close();
  const closedAt = Date.now();
  // The store answers a second after the tab died: its last chunk is stored after its Port dropped.
  await sleep(1_000);
  const { released } = releasedChunksSchema.parse(await probe(control, 'store:release-chunks'));
  expectEqual(released, 1, 'held chunks released');
  console.log(
    `  the tab died with chunk ${storedBefore} still being stored, stored ${((Date.now() - closedAt) / 1000).toFixed(1)} s later`,
  );
  const report = async () => {
    console.log(`    stored: ${JSON.stringify(await stored())}`);
    for (const line of (await backgroundDiagnostics(control)).filter(
      (l) => l.slice(0, 12) >= since && (l.includes(id) || l.includes('(recovered)')),
    )) {
      console.log(`    diagnostics: ${line}`);
    }
  };
  // The background's grace for a lost tab is 10 s.
  const file = await waitFor(
    'a "(recovered)" file',
    async () => (await recoveredFiles(before)).at(0),
    30_000,
  ).catch(async () => {
    await report();
    throw new Error(
      `no file ${((Date.now() - closedAt) / 1000).toFixed(1)} s after the tab died: still ${(await stored())?.status}`,
    );
  });
  const info = await inspectWebm(await waitForCompleteFile(file));
  console.log(
    `  recovered ${((Date.now() - closedAt) / 1000).toFixed(1)} s after the tab died: ${path.basename(file)} → ${describeWebm(info)}`,
  );
  console.log(`    ffprobe: ${ffprobe(file)}`);
  await expectEventually(
    'status of the recovered recording',
    async () => (await stored())?.status,
    'saved',
  );
  await report();
  const recording = await stored();
  if (!((recording?.chunkCount ?? 0) > storedBefore)) {
    throw new Error(
      `the held chunk is missing: ${recording?.chunkCount} chunks, ${storedBefore} before it`,
    );
  }
  if (!(info.durationS > 6)) throw new Error(`recovered file too short: ${info.durationS} s`);
  await control.close();
}

/** Reloads the extension (as in scenario 5) and opens a meeting page that is not joined. */
async function reloadExtension(browser: Browser, target: FixtureTarget): Promise<Page> {
  await browser.installExtension(EXTENSION_DIR);
  return openMeeting(browser, meetingUrl(target));
}

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
      recordingStateSchema
        .parse(await probe(control, 'background:state'))
        .recordings.filter((recording) => ids.includes(recording.id) && recording.chunkCount > 1);
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
    // A fresh background's recovery pass (30 s after it starts) takes a recording only once its
    // last chunk is 60 s old. Probing meanwhile keeps the event page from being suspended.
    await waitFor(
      'the recordings to turn stale',
      async () => {
        await probe(control, 'background:state');
        return Date.now() > closedAt + 35_000;
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

/** A title Firefox refuses as a file name: a joined emoji and right-to-left marks. */
const REFUSED_TITLE = 'Dev 👨\u200D💻 sync \u200Fשלום\u200F';
/** The same title in a file name: the joiner and the marks dropped, the emoji kept. */
const REFUSED_TITLE_SAVED = 'Dev 👨💻 sync שלום';
const FALLBACK_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_recording(?:\(\d+\))?\.webm$/;

/** Stops the page's recording `id`, waits until it is finalized and prints what it left. */
async function stopAndCollect(page: Page, id: string, before: ReadonlySet<string>) {
  await sleep(4_000);
  const stoppedAt = new Date().toISOString().slice(11, 23);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const [recording] = await waitForFinalized(page, [id]);
  if (!recording) throw new Error(`recording ${id} not finalized`);
  console.log(`  ${id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}`);
  // Lines start with their UTC time: only the ones written since Stop.
  const lines = (await backgroundDiagnostics(page)).filter(
    (line) => line.slice(0, 12) >= stoppedAt,
  );
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  await sleep(1_000);
  const files = await newRecordings(before);
  if (files.length === 0) console.log('  no file saved');
  for (const file of files) {
    const info = await inspectWebm(await waitForCompleteFile(file));
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    if (!(info.durationS > 2)) throw new Error(`file too short: ${info.durationS} s`);
  }
  return { recording, lines, names: files.map((file) => path.basename(file)) };
}

export async function scenarioRefusedFileName({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 11: a title Firefox refuses as a file name, then a refused name → saved`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.evaluate((title) => window.__fixture.setTitle(title), REFUSED_TITLE);
    let before = new Set(await listWebm());
    await page.click('#start');
    const titled = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const first = await stopAndCollect(page, titled, before);
    expectEqual(first.recording.status, 'saved', `status of ${titled}`);
    expectEqual(first.names.length, 1, 'files saved for the titled recording');
    const [name] = first.names;
    if (!name?.includes(REFUSED_TITLE_SAVED) || /\p{Cf}/u.test(name)) {
      throw new Error(`unexpected file name ${JSON.stringify(name)}`);
    }

    // A name Firefox refuses anyway (one the sanitizer missed) → saved once under the fallback.
    before = new Set(await listWebm());
    const armed = z
      .object({ armed: z.literal(true) })
      .safeParse(await probe(page, 'save:refuse-next-name'));
    if (!armed.success) throw new Error('could not arm the name refusal through the debug probe');
    await page.evaluate(() => window.__fixture.clickOverlay('Record'));
    const refused = await waitFor(
      'the next recording',
      async () => {
        const id = await currentRecordingId(page);
        return id !== titled && id;
      },
      20_000,
    );
    const second = await stopAndCollect(page, refused, before);
    expectEqual(second.recording.status, 'saved', `status of ${refused}`);
    expectEqual(second.names.length, 1, 'files saved for the refused recording');
    if (!FALLBACK_NAME_RE.test(second.names[0] ?? '')) {
      throw new Error(`not the fallback name: ${JSON.stringify(second.names[0])}`);
    }
    if (!second.lines.some((line) => line.includes('Firefox refused the file name'))) {
      throw new Error('no "Firefox refused the file name" line in Diagnostics');
    }
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

/** What finalize stores and logs for a recording that has no audio or video sample. */
const NOTHING_RECORDED =
  'nothing was recorded (stopped before the first audio or video sample); no file saved';
/** A sample can get into the recording before the Stop arrives: then the page tries again. */
export const STOP_AT_ONCE_ATTEMPTS = 3;

/**
 * Clicks Record, then Stop as soon as the page session has a recording id and the overlay shows
 * Stop. Inside the page, with no named function: tsx would wrap one in a helper the page lacks.
 */
export async function recordAndStopAtOnce(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const started = performance.now();
    if (!window.__fixture.clickOverlay('Record')) throw new Error('no Record button');
    while (performance.now() - started < 10_000) {
      const id = window.__zenRecorderPage?.snapshot().recordingId;
      if (id && window.__fixture.clickOverlay('Stop')) return id;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('no recording id and Stop button 10 s after Record');
  });
}

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

/** Firefox's fake microphone plays a 1 kHz tone; the fixtures' remote participants send 440 Hz. */
const MIC_TONE_HZ = 1000;

export async function scenarioStoppedMicrophone({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 13: a microphone the page stopped (no event) is not the one recorded`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const snapshot = () => page.evaluate(() => window.__zenRecorderPage?.snapshot());
  // The Teams fixture opens the microphone on load and stops it at once, as Teams does.
  await sleep(1_500);
  const labelBeforeJoin = (await snapshot())?.micLabel ?? null;
  console.log(`  microphone named before joining: ${JSON.stringify(labelBeforeJoin)}`);
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 30_000);
  const startedAt = (await snapshot())?.recordingStartedAt;
  if (!startedAt) throw new Error('the recording has no start time');
  await sleep(4_000);
  const testStarted = Date.now();
  await page.evaluate(() => window.__fixture.micTest());
  const testEnded = Date.now();
  await sleep(6_000);
  const labelAfterTest = (await snapshot())?.micLabel ?? null;
  console.log(`  microphone named after the test: ${JSON.stringify(labelAfterTest)}`);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  const at = (ms: number) => (ms - startedAt) / 1000;
  const windows = {
    'before the test': [1, at(testStarted) - 0.5],
    'during the test': [at(testStarted) + 0.5, at(testEnded) - 0.5],
    'after the test': [at(testEnded) + 1, info.durationS - 0.5],
  } satisfies Record<string, [number, number]>;
  const levels = Object.fromEntries(
    Object.entries(windows).map(([name, [from, to]]) => [
      name,
      toneLevel(file, MIC_TONE_HZ, from, to),
    ]),
  );
  for (const [name, [from, to]] of Object.entries(windows)) {
    console.log(
      `  microphone ${name} (${from.toFixed(1)}-${to.toFixed(1)} s): ${levels[name]?.toFixed(1)} dBFS`,
    );
  }
  const problems: string[] = [];
  if (labelBeforeJoin !== null) {
    problems.push(`a stopped microphone is named before joining: ${labelBeforeJoin}`);
  }
  if (labelAfterTest === null) problems.push('no microphone named after the test');
  const beforeTest = levels['before the test'] ?? Number.NEGATIVE_INFINITY;
  const afterTest = levels['after the test'] ?? Number.NEGATIVE_INFINITY;
  if (!(beforeTest > -40)) problems.push(`microphone silent before the test: ${beforeTest} dBFS`);
  if (!(afterTest > beforeTest - 6)) {
    problems.push(`microphone at ${afterTest} dBFS after the test, ${beforeTest} dBFS before it`);
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
  await page.close();
}

/** How long the page is kept busy right before Pause and right before Stop. */
const BUSY_MS = 2_500;
/** Seconds of the file that hold the start-up, before the first busy spell. */
const STARTUP_S = 3;

/**
 * Keeps the page's main thread busy for `BUSY_MS`, then clicks an overlay button in the same task,
 * as a heavy meeting page would: what the audio thread posted meanwhile is still queued for the
 * page when the click is handled. Returns the time of the click.
 */
async function busyThenClick(page: Page, button: string): Promise<number> {
  return page.evaluate(
    (name, busyMs) => {
      const end = performance.now() + busyMs;
      while (performance.now() < end) {
        // a long task: nothing else runs on the page meanwhile
      }
      if (!window.__fixture.clickOverlay(name)) throw new Error(`no ${name} button`);
      return Date.now();
    },
    button,
    BUSY_MS,
  );
}

export async function scenarioBusyPageKeepsQueuedAudio({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 14: a busy page right before Pause and Stop → its queued audio is kept`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
  if (!result.success || result.data.videoMode !== 'tiles') {
    throw new Error('could not switch video on through the debug probe');
  }
  await page.click('#start');
  const startedAt = await waitFor(
    'recording started',
    () => page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt),
    20_000,
  );
  await sleep(4_000);
  const pausedAt = await busyThenClick(page, 'Pause');
  await waitFor('paused', async () => (await overlayState(page)) === 'paused', 10_000);
  await sleep(3_000);
  const resumedAt = await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Resume')) throw new Error('no Resume button');
    return Date.now();
  });
  // Longer than the 2 s window of the audio clock repair: a pre-pause loss would be filled here.
  await sleep(4_000);
  const stoppedAt = await busyThenClick(page, 'Stop');
  const file = await waitForNewRecording(before);
  const expectedS = (stoppedAt - startedAt - (resumedAt - pausedAt)) / 1000;
  const ends = await trackEnds(file);
  const gaps = silences(file, 0.3);
  const lastSecond = meanVolume(file, expectedS - 1, expectedS);
  const repairs = (await pageDiagnostics(page)).filter((line) => line.includes('filled with'));
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  console.log(
    `  recorded ${expectedS.toFixed(2)} s (Stop - start - pause); audio ends at ${ends.audioS?.toFixed(2)} s, video at ${ends.videoS?.toFixed(2)} s`,
  );
  console.log(`  silences ≥ 0.3 s: ${JSON.stringify(gaps)}`);
  console.log(
    `  last second before Stop: ${lastSecond === null ? 'no audio' : `${lastSecond} dB`}`,
  );
  for (const line of repairs) console.log(`  diagnostics: ${line}`);
  await page.close();
  if (ends.audioS === null || ends.audioS < expectedS - 0.5) {
    throw new Error(
      `the audio ends at ${ends.audioS} s, before the Stop at ${expectedS.toFixed(2)} s`,
    );
  }
  if (lastSecond === null || lastSecond < -50) {
    throw new Error(`the last second before Stop is silent (${lastSecond} dB)`);
  }
  // A start-up gap (the tap attaching while the page is busy starting) is not what this guards.
  const long = gaps.filter(([start, duration]) => start > STARTUP_S && duration >= 1);
  if (long.length > 0) {
    throw new Error(
      `silent stretches in the audio: ${JSON.stringify(long)} (lost before the Pause)`,
    );
  }
}

export async function scenarioEndNoticeLost({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 15: the Port drops while the recording stops → the end is sent again, the file saved under its own name`,
  );
  const before = new Set(await listWebm());
  // Diagnostics lines start with their UTC time: only the ones written from here on.
  const since = new Date().toISOString().slice(11, 23);
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const stored = () => storedRecording(page, id);
  await waitFor('the first chunk stored', async () => (await stored())?.chunkCount, 15_000);
  await sleep(3_000);
  await dropPortOnNextEnd(page);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const stoppedAt = Date.now();
  await waitFor(
    'the end notice posted while the Port is down',
    () => page.evaluate(() => window.__e2eEndReleased === true),
    20_000,
  );
  console.log('  the background dropped the Port while the recording stopped');
  const report = async () => {
    const seconds = Math.round((Date.now() - stoppedAt) / 1000);
    const notices = await page.evaluate(() => window.__e2eEndNotices ?? 0);
    console.log(
      `  ${seconds} s after Stop: ${JSON.stringify(await stored())}, ${notices} end(s) sent`,
    );
    const lines = [...(await pageDiagnostics(page)), ...(await backgroundDiagnostics(page))];
    for (const line of lines.filter((l) => l.slice(0, 12) >= since).sort()) {
      console.log(`  diagnostics: ${line}`);
    }
  };
  const file = await waitForNewRecording(before).catch(async (error: unknown) => {
    await report();
    throw error;
  });
  const savedAfterS = (Date.now() - stoppedAt) / 1000;
  // The file is complete on disk a moment before the background has marked the recording saved.
  await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
  await report();
  const info = await inspectWebm(file);
  console.log(
    `  saved ${savedAfterS.toFixed(1)} s after Stop: ${path.basename(file)} → ${describeWebm(info)}`,
  );
  console.log(`    ffprobe: ${ffprobe(file)}`);
  // The first end found the Port down; the page sent it again until the background had it.
  const notices = await page.evaluate(() => window.__e2eEndNotices ?? 0);
  console.log(`  the page sent the end ${notices} times`);
  if (notices < 2) throw new Error(`the end was sent ${notices} time(s), never again`);
  if (file.includes('(recovered)')) throw new Error('a recording that ended cleanly was recovered');
  if (!(info.durationS > 4)) throw new Error(`file too short: ${info.durationS} s`);
  await sleep(3_000);
  expectEqual((await newRecordings(before)).length, 1, 'files saved for one recording');
  await page.close();
}

/** How long the page stays busy in scenario 16: long enough for the old 2 s repair window, twice. */
const BACKLOG_MS = 8_000;
/** Each of the page's long tasks in scenario 16. */
const LONG_TASK_MS = 100;

/**
 * Keeps the page busy for `BACKLOG_MS` with back-to-back long tasks. They are scheduled through a
 * MessagePort, like the audio tap's buffers, so the two take turns: the page handles about one
 * buffer per long task, fewer than the tap posts, and the audio reaches it later and later.
 */
async function busyFor(page: Page): Promise<void> {
  await page.evaluate(
    (busyMs, taskMs) =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        const end = performance.now() + busyMs;
        channel.port1.onmessage = () => {
          const taskEnd = performance.now() + taskMs;
          while (performance.now() < taskEnd) {
            // a long task: nothing else runs on the page meanwhile
          }
          if (performance.now() < end) channel.port2.postMessage(null);
          else resolve();
        };
        channel.port2.postMessage(null);
      }),
    BACKLOG_MS,
    LONG_TASK_MS,
  );
}

export async function scenarioSustainedBacklog({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 16: the page stays busy for ${BACKLOG_MS / 1000} s → no silence inserted, the file as long as the recording`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
  if (!result.success || result.data.videoMode !== 'tiles') {
    throw new Error('could not switch video on through the debug probe');
  }
  await page.click('#start');
  const startedAt = await waitFor(
    'recording started',
    () => page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt),
    20_000,
  );
  await sleep(STARTUP_S * 1_000);
  await busyFor(page);
  // Idle again: the queued audio drains, then the recording goes on for a while.
  await sleep(5_000);
  const stoppedAt = await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
    return Date.now();
  });
  const file = await waitForNewRecording(before);
  const expectedS = (stoppedAt - startedAt) / 1000;
  const ends = await trackEnds(file);
  const gaps = silences(file, 0.3);
  const audioLines = (await pageDiagnostics(page, startedAt)).filter(
    (line) =>
      line.includes('filled with') || line.includes('audio clock') || line.includes('audio starts'),
  );
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  console.log(
    `  recorded ${expectedS.toFixed(2)} s (Stop - start); audio ends at ${ends.audioS?.toFixed(2)} s, video at ${ends.videoS?.toFixed(2)} s`,
  );
  console.log(`  silences ≥ 0.3 s: ${JSON.stringify(gaps)}`);
  for (const line of audioLines) console.log(`  diagnostics: ${line}`);
  await page.close();
  const problems: string[] = [];
  const repairs = audioLines.filter((line) => line.includes('filled with'));
  if (repairs.length > 0) problems.push(`silence inserted for late audio: ${repairs.join('; ')}`);
  if (ends.audioS === null || Math.abs(ends.audioS - expectedS) > 0.5) {
    problems.push(`the audio is ${ends.audioS} s long for a ${expectedS.toFixed(2)} s recording`);
  }
  const long = gaps.filter(([start]) => start > STARTUP_S);
  if (long.length > 0) problems.push(`silent stretches in the audio: ${JSON.stringify(long)}`);
  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** Seconds at the start of the file that must hold the page's audio in scenario 35. */
const FIRST_AUDIO_S = 3;
/**
 * Silence before the first audio buffer that scenario 35 accepts: the tap attaching takes
 * 0.03-0.07 s, a graph that still has to open the audio device 0.35 s and more.
 */
const MAX_AUDIO_LEAD_S = 0.15;
/**
 * How long scenario 35 stays on the page before joining, as a person does in the lobby: longer
 * than a page's first audio stream takes to open the audio device (up to 1.8 s in the lab).
 */
const LOBBY_MS = 3_000;

export async function scenarioFirstSecondsHaveAudio({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 35: the first recording in a freshly opened meeting page → audio from its first moment`,
  );
  const before = new Set(await listWebm());
  const openedAt = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
  if (!result.success || result.data.videoMode !== 'tiles') {
    throw new Error('could not switch video on through the debug probe');
  }
  await sleep(LOBBY_MS);
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  await sleep(6_000);
  await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
  });
  const file = await waitForNewRecording(before);
  const lines = (await pageDiagnostics(page, openedAt)).filter(
    (line) => line.includes('audio starts') || line.includes('audio warm-up'),
  );
  const starts = lines.find((line) => line.includes('audio starts'));
  const lead = Number(/audio starts ([\d.]+) s/.exec(starts ?? '')?.[1]);
  const levels = levelsOverTime(file, 0, 5, 0.1);
  const gaps = silences(file, 0.3).filter(([start]) => start < FIRST_AUDIO_S);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  console.log(
    `  level per 100 ms over the first 5 s (dBFS): ${levels.map((level) => level.toFixed(0)).join(' ')}`,
  );
  console.log(`  silences ≥ 0.3 s in the first ${FIRST_AUDIO_S} s: ${JSON.stringify(gaps)}`);
  await page.close();
  const problems: string[] = [];
  if (!(lead <= MAX_AUDIO_LEAD_S)) {
    problems.push(
      `the audio starts ${Number.isNaN(lead) ? '(no "audio starts" line)' : `${lead} s`} into the recording: its audio graph was not running yet`,
    );
  }
  if (gaps.length > 0) {
    problems.push(`silent stretches in the first ${FIRST_AUDIO_S} s: ${JSON.stringify(gaps)}`);
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** How long the guest waits to be let in: several of the session's once-a-second page reads. */
const KNOCK_MS = 8_000;

export async function scenarioGuestKnocks({ browser, target }: ScenarioContext): Promise<void> {
  const { hostMeetingPath } = target;
  if (!hostMeetingPath) {
    console.log(`▶ ${target.id} scenario 17: skipped (the fake page has no host side)`);
    return;
  }
  console.log(
    `▶ ${target.id} scenario 17: the host alone, a guest knocks → nothing records until the guest is let in`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target, hostMeetingPath));
  await page.click('#start');
  const overlay = () => page.evaluate(() => window.__fixture.overlayState());
  let last: Awaited<ReturnType<typeof overlay>> = null;
  await waitFor(
    'the host alone in the meeting',
    async () => {
      last = await overlay();
      const inCall = (await page.evaluate(() => window.__fixture.tileCount())) === 1;
      return inCall && last?.state === 'waiting' && !last.text?.includes('to be admitted');
    },
    20_000,
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}; the overlay last showed ${JSON.stringify(last)}`);
  });
  await sleep(2_000);
  expectEqual(await overlayState(page), 'waiting', 'state while alone');
  const knockedAt = await page.evaluate(() => {
    window.__fixture.knock?.();
    return Date.now();
  });
  const seen = new Set<string>();
  let startedWhileWaiting: number | null = null;
  while (Date.now() - knockedAt < KNOCK_MS) {
    const state = await overlayState(page);
    const counter = await page.evaluate(
      () => document.querySelector('#participant .footer-button__number-counter')?.textContent,
    );
    seen.add(`${state} (participant counter ${counter})`);
    if (startedWhileWaiting === null && (await recordingStarted(page))) {
      startedWhileWaiting = Date.now() - knockedAt;
    }
    await sleep(250);
  }
  console.log(`  while the guest waits: ${JSON.stringify([...seen])}`);
  if (startedWhileWaiting !== null) {
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    const early = await waitForNewRecording(before);
    console.log(`  saved: ${path.basename(early)} → ${describeWebm(await inspectWebm(early))}`);
    await page.close();
    throw new Error(
      `a recording started ${startedWhileWaiting} ms after the guest knocked, before anyone was let in`,
    );
  }
  const letInAt = await page.evaluate(() => {
    window.__fixture.letIn?.();
    return Date.now();
  });
  const startedAt = await waitFor(
    'recording once the guest is in',
    () => page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt),
    10_000,
  );
  console.log(`  recording started ${startedAt - letInAt} ms after the guest was let in`);
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  await page.close();
}

/** Where the meeting page goes in scenario 20: away from the service, as a typed address does. */
const AWAY_URL = 'about:blank';
/** The background waits 10 s for a lost tab before it saves the recording as "(recovered)". */
const SAVED_WITHIN_S = 8;

export async function scenarioPageGoneWhileRecording({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 20: the page goes away while it records → saved at once under its own name`,
  );
  // Not in the call: it reads the background's state once a meeting tab is gone.
  const control = await openMeeting(browser, meetingUrl(target));
  const problems: string[] = [];
  /**
   * Records in a new meeting tab until two chunks are stored, lets `goAway` end the page, and
   * checks the file: saved before the background's grace for a lost tab is over, under its own
   * name, one file.
   */
  const recordUntilGone = async (label: string, goAway: (page: Page) => Promise<number>) => {
    const before = new Set(await listWebm());
    const since = new Date().toISOString().slice(11, 23);
    const page = await openMeeting(browser, meetingUrl(target));
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const stored = () => storedRecording(control, id);
    await waitFor('two chunks stored', async () => ((await stored())?.chunkCount ?? 0) > 1, 20_000);
    const goneAt = await goAway(page);
    const report = async () => {
      console.log(`    stored: ${JSON.stringify(await stored())}`);
      const lines = [
        ...(await pageDiagnostics(control)),
        ...(await backgroundDiagnostics(control)),
      ];
      for (const line of lines.filter((l) => l.slice(0, 12) >= since).sort()) {
        console.log(`    diagnostics: ${line}`);
      }
    };
    const file = await waitForNewRecording(before).catch(() => null);
    const savedAfterS = (Date.now() - goneAt) / 1000;
    if (!file) {
      console.log(`  ${label}: no file ${savedAfterS.toFixed(1)} s after the page went away`);
      await report();
      problems.push(`${label}: no file saved`);
      if (!page.isClosed()) await page.close();
      return;
    }
    const info = await inspectWebm(file);
    console.log(
      `  ${label}: saved ${savedAfterS.toFixed(1)} s later as ${path.basename(file)} → ${describeWebm(info)}`,
    );
    console.log(`    ffprobe: ${ffprobe(file)}`);
    await report();
    if (file.includes('(recovered)')) problems.push(`${label}: saved as "(recovered)"`);
    if (savedAfterS > SAVED_WITHIN_S) {
      problems.push(`${label}: saved ${savedAfterS.toFixed(1)} s after the page went away`);
    }
    await expectEventually(`${label}: status`, async () => (await stored())?.status, 'saved').catch(
      (error: unknown) => problems.push(error instanceof Error ? error.message : String(error)),
    );
    if (!(info.durationS > 3)) problems.push(`${label}: file too short (${info.durationS} s)`);
    await sleep(2_000);
    const files = (await newRecordings(before)).length;
    if (files !== 1) problems.push(`${label}: ${files} files for one recording`);
    if (!page.isClosed()) await page.close();
  };

  // The user leaves and the page navigates before the stop is done: Zoom's Leave on a busy
  // machine, or the OK of "ended by the host" right away. The page's own end never leaves it.
  await recordUntilGone('navigated away right after leaving', (page) =>
    page.evaluate((url) => {
      window.__fixture.leave();
      location.assign(url);
      return Date.now();
    }, AWAY_URL),
  );
  await recordUntilGone('tab closed', async (page) => {
    const goneAt = Date.now();
    await page.close();
    return goneAt;
  });
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** The short form of the independence notice, which ends the manifest description. */
const SHORT_NOTICE = 'Independent project, not affiliated with Zen Browser.';
const optionsFooterSchema = z.object({ footer: z.array(z.string()).nullable() });

/**
 * Every place that presents the project carries the independence notice: here the two the build
 * makes, the manifest description and the Options page footer, which also names the version.
 */
export async function scenarioProjectNotice({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 22: the manifest description and the Options page footer carry the independence notice`,
  );
  const { version, description } = builtManifest();
  console.log(`  manifest description: ${description}`);
  // The page only relays the probe: the background opens the Options page and reads its footer.
  const page = await openMeeting(browser, meetingUrl(target));
  const answer = await probe(page, 'options:footer');
  await page.close();
  const parsed = optionsFooterSchema.safeParse(answer);
  if (!parsed.success) throw new Error(`options:footer probe: ${JSON.stringify(answer)}`);
  const footer = parsed.data.footer;
  console.log(`  Options page footer: ${footer ? JSON.stringify(footer) : '(none)'}`);
  const problems = [
    ...(description.endsWith(` ${SHORT_NOTICE}`)
      ? []
      : [`the manifest description does not end with "${SHORT_NOTICE}"`]),
    ...(footer?.includes(`Zen Recorder ${version}`)
      ? []
      : [`the Options page footer does not name the version ${version}`]),
    ...(footer?.includes(getProjectTexts().notice)
      ? []
      : ['the Options page footer does not carry the notice']),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** The page's backlog limit in scenario 33: the fixture's video fills it in about 30 s. */
const SMALL_BACKLOG_BYTES = 2 * 2 ** 20;

const pageStateSchema = z.object({
  id: z.string().nullable(),
  debug: z.object({
    video: z.unknown().nullable(),
    backlog: z.object({ bytes: z.number(), chunks: z.number() }).nullable(),
  }),
});

export async function scenarioBacklogFull({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 33: the extension takes no chunk for a long time → the video stops at the page's limit, audio goes on, nothing is dropped`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const limit = await page.evaluate(
    (bytes) => window.__zenRecorderPage?.setBacklogLimit?.(bytes) ?? null,
    SMALL_BACKLOG_BYTES,
  );
  if (limit?.backlogLimitBytes !== SMALL_BACKLOG_BYTES) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
  await page.click('#start');
  const first = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const firstStartedAt = await recordingStartedAt(page);
  const recordings = async () =>
    recordingStateSchema.parse(await probe(page, 'background:state')).recordings;
  const stored = async (id: string) => (await recordings()).find((r) => r.id === id);
  await waitFor('the first chunk stored', async () => (await stored(first))?.chunkCount, 15_000);
  // The store stops answering: the tab's chunks wait, as they do on a full disk or with no bridge.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  const heldAt = Date.now();
  const readPage = async () =>
    pageStateSchema.parse(
      await page.evaluate(() => ({
        id: window.__zenRecorderPage?.snapshot().recordingId ?? null,
        debug: window.__zenRecorderPage?.debug(),
      })),
    );
  let peak = 0;
  const next = await waitFor(
    'an audio-only recording once the video filled the backlog',
    async () => {
      const state = await readPage();
      peak = Math.max(peak, state.id === first ? (state.debug.backlog?.bytes ?? 0) : 0);
      return state.id !== null && state.id !== first && state.debug.video === null
        ? state.id
        : null;
    },
    120_000,
  ).finally(async () => {
    console.log(`  background: ${JSON.stringify(await recordings())}`);
  });
  const switchedS = (Date.now() - heldAt) / 1000;
  const nextStartedAt = await recordingStartedAt(page);
  console.log(
    `  ${switchedS.toFixed(1)} s after the hold: audio only (${next}); the video's backlog peaked at ${peak} bytes before it filled`,
  );
  if (peak > SMALL_BACKLOG_BYTES) {
    throw new Error(`the page held ${peak} bytes, more than its limit of ${SMALL_BACKLOG_BYTES}`);
  }
  // The audio goes on beside the full backlog while the store still holds everything.
  await sleep(8_000);
  const audio = await readPage();
  console.log(`  audio-only backlog after 8 s: ${JSON.stringify(audio.debug.backlog)}`);
  expectEqual(audio.id, next, 'recording while the store still holds');
  // Hung up while it still holds: once the extension took the video recording, a meeting still on
  // would record with video again (scenario 62). Meet notices a hang-up seconds later.
  await page.evaluate(() => window.__fixture.hangup());
  await waitFor('the meeting over', async () => (await currentRecordingId(page)) === null, 20_000);
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  await waitFor(
    `${first} saved`,
    async () => (await stored(first))?.status === 'saved',
    60_000,
  ).catch(async (error: unknown) => {
    console.log(`  background: ${JSON.stringify(await recordings())}`);
    throw error;
  });
  const files = await waitFor(
    'the video file and the audio-only one',
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= 2 ? saved : null;
    },
    60_000,
  );
  // Every line checked below was written before the files were saved.
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [first, next, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/backlog|recording ended|saved|gap|could not/.test(line))
      console.log(`  diagnostics: ${line}`);
  }
  const full = pageLines.find((line) => line.includes(`backlog full:`) && line.includes(first));
  if (!full?.includes('the rest of the meeting records audio only')) {
    throw new Error('Diagnostics do not say why the video recording stopped');
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
  // The page's two "recording ended" lines, in order: the video recording's, then the audio one's.
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  if (!ended[0]?.includes('recording ended (backlog-full)')) {
    throw new Error(`the video recording did not end as backlog-full: ${ended[0]}`);
  }
  // Every chunk the page recorded is in its file.
  for (const [index, id] of [first, next].entries()) {
    const sent = ended[index]?.match(/after (\d+) chunks/)?.[1] ?? 'none';
    expectEqual(String((await stored(id))?.chunkCount), sent, `chunks stored for ${id}`);
  }
  const infos = await Promise.all(
    files.map(async (file) => ({ file, info: await inspectWebm(await waitForCompleteFile(file)) })),
  );
  for (const { file, info } of infos) {
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
  }
  const withVideo = infos.filter(({ info }) => info.video !== null);
  const audioOnly = infos.filter(({ info }) => info.video === null && info.tracks === 1);
  expectEqual(withVideo.length, 1, 'files with video');
  expectEqual(audioOnly.length, 1, 'audio-only files');
  const videoS = withVideo[0]?.info.durationS ?? 0;
  if (!(videoS > switchedS)) {
    throw new Error(`the video file (${videoS} s) does not reach the switch (${switchedS} s in)`);
  }
  // The audio-only recording starts where the video one stopped: the outage is in the files.
  const gapS = (nextStartedAt - firstStartedAt) / 1000 - videoS;
  console.log(`  between the two files: ${gapS.toFixed(2)} s`);
  if (gapS > 3) throw new Error(`${gapS.toFixed(1)} s of the meeting are in neither file`);
  await page.close();
}

/** How long scenario 37 keeps the store held after the video fails. */
const HOLD_AFTER_VIDEO_ERROR_MS = 15_000;
/** The longest the audio-only recording may take to start after the video fails. */
const MAX_SWITCH_S = 3;

export async function scenarioVideoErrorDuringOutage({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 37: the video encoder fails while the extension takes no chunk → audio only at once, both files whole`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const readPage = async () =>
    pageStateSchema.parse(
      await page.evaluate(() => ({
        id: window.__zenRecorderPage?.snapshot().recordingId ?? null,
        debug: window.__zenRecorderPage?.debug(),
      })),
    );
  const first = await waitFor(
    'a recording with video',
    async () => {
      const state = await readPage();
      return state.debug.video !== null ? state.id : null;
    },
    20_000,
  );
  const firstStartedAt = await recordingStartedAt(page);
  const recordings = async () =>
    recordingStateSchema.parse(await probe(page, 'background:state')).recordings;
  const stored = async (id: string) => (await recordings()).find((r) => r.id === id);
  await waitFor('the first chunk stored', async () => (await stored(first))?.chunkCount, 15_000);
  // The store stops answering: the tab's chunks wait in the page, as they do while the
  // background restarts or the disk is full.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  await sleep(4_000);
  const held = await readPage();
  console.log(`  video backlog before the error: ${JSON.stringify(held.debug.backlog)}`);
  const failedAt = await failVideoEncoder(page, 'injected by the e2e run');
  const heldUntil = Date.now() + HOLD_AFTER_VIDEO_ERROR_MS;
  const audioOnly = async () => {
    const state = await readPage();
    return state.id !== null && state.id !== first && state.debug.video === null ? state.id : null;
  };
  const duringHold = await waitFor(
    'an audio-only recording while the store holds',
    audioOnly,
    HOLD_AFTER_VIDEO_ERROR_MS,
  ).catch(() => null);
  await sleep(Math.max(0, heldUntil - Date.now()));
  const audio = await readPage();
  console.log(
    `  ${HOLD_AFTER_VIDEO_ERROR_MS / 1000} s after the error, the store still held: recording ${audio.id ?? 'none'}, backlog ${JSON.stringify(audio.debug.backlog)}`,
  );
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  const next = duringHold ?? (await waitFor('an audio-only recording', audioOnly, 60_000));
  const switchS = ((await recordingStartedAt(page)) - failedAt) / 1000;
  console.log(
    `  the audio-only recording ${next} started ${switchS.toFixed(2)} s after the video error, ${duringHold ? 'while the store held' : 'only once the store was released'}`,
  );
  await waitFor(
    `${first} saved`,
    async () => (await stored(first))?.status === 'saved',
    60_000,
  ).catch(async (error: unknown) => {
    console.log(`  background: ${JSON.stringify(await recordings())}`);
    throw error;
  });
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const files = await waitFor(
    'two saved files',
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= 2 ? saved : null;
    },
    60_000,
  );
  await sleep(2_000);
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [first, next, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/video encoder error|recording (started|ended)|saved|gap|could not/.test(line))
      console.log(`  diagnostics: ${line}`);
  }
  if (!pageLines.some((line) => line.includes('video encoder error: injected by the e2e run'))) {
    throw new Error('Diagnostics do not say that the video encoder failed');
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
  // The page's two "recording ended" lines, in order: the video recording's, then the audio one's.
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  if (!ended[0]?.includes('recording ended (encoder-error)')) {
    throw new Error(`the video recording did not end as encoder-error: ${ended[0]}`);
  }
  // Every chunk the page recorded is in its file.
  for (const [index, id] of [first, next].entries()) {
    const sent = ended[index]?.match(/after (\d+) chunks/)?.[1] ?? 'none';
    expectEqual(String((await stored(id))?.chunkCount), sent, `chunks stored for ${id}`);
  }
  const infos = await Promise.all(
    files.map(async (file) => ({ file, info: await inspectWebm(await waitForCompleteFile(file)) })),
  );
  for (const { file, info } of infos) {
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
  }
  const withVideo = infos.filter(({ info }) => info.video !== null);
  const audioOnlyFiles = infos.filter(({ info }) => info.video === null && info.tracks === 1);
  expectEqual(withVideo.length, 1, 'files with video');
  expectEqual(audioOnlyFiles.length, 1, 'audio-only files');
  const videoS = withVideo[0]?.info.durationS ?? 0;
  const failedS = (failedAt - firstStartedAt) / 1000;
  console.log(`  video file ${videoS.toFixed(2)} s, video error ${failedS.toFixed(2)} s in`);
  if (Math.abs(videoS - failedS) > MAX_SWITCH_S) {
    throw new Error(`the video file (${videoS} s) does not end at the error (${failedS} s in)`);
  }
  // The meeting between the video error and the audio-only recording is in neither file.
  if (switchS > MAX_SWITCH_S) {
    throw new Error(
      `the audio-only recording started ${switchS.toFixed(1)} s after the video error: nothing was recorded in between`,
    );
  }
  await page.close();
}

const strayChunksSchema = z.object({ stale: z.string(), recent: z.string() });
const recordingsWithChunksSchema = z.object({ ids: z.array(z.string()) });

export async function scenarioChunkBookkeeping({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 38: a chunk stored after its ack timeout is counted once, and chunks whose recording was never stored are deleted once a day old`,
  );
  const problems: string[] = [];
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const stored = () => storedRecording(page, id);
    await waitFor('the first chunk stored', async () => (await stored())?.chunkCount, 15_000);
    // A busy store: the next chunk is stored only once the probe releases it.
    await probe(page, 'store:hold-next-chunk');
    await waitFor(
      'a chunk held in the store',
      async () => heldChunksSchema.parse(await probe(page, 'store:held-chunks')).held > 0,
      15_000,
    );
    const heldSeq = (await stored())?.chunkCount ?? 0;
    // The bridge gives up on the ack after 10 s and the page sends the chunk again 1 s later.
    // That send waits in the tab's queue behind the held one, which is stored first.
    await sleep(13_000);
    const { released } = releasedChunksSchema.parse(await probe(page, 'store:release-chunks'));
    expectEqual(released, 1, 'held chunks released');
    console.log(`  chunk ${heldSeq} held for 13 s, sent again by the page, then released`);
    // The chunk after the held one is sent only once the held one is acked, and the background
    // handles it after the second send of the held one.
    await waitFor(
      'the chunk after the held one stored',
      async () => ((await stored())?.chunkCount ?? 0) >= heldSeq + 2,
      20_000,
    );
    // While its save is held, the recording keeps the totals counted while it recorded: finalize
    // replaces the byte count with the saved file's size.
    await probe(page, 'save:hold-next');
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    const counted = await waitFor(
      'the recording finalizing',
      async () => {
        const recording = await stored();
        return recording?.status === 'finalizing' ? recording : null;
      },
      30_000,
    );
    await probe(page, 'save:release');
    const file = await waitForNewRecording(before);
    // The background logs the save once the recording is marked saved, a moment after the file.
    await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
    const lines = (await backgroundDiagnostics(page)).filter(
      (line) => line.includes(id) || line.includes(path.basename(file)),
    );
    for (const line of lines) console.log(`  diagnostics: ${line}`);
    const saved = lines
      .map((line) => line.match(/ info: saved .* \((\d+) chunks, (\d+) bytes\)$/))
      .find(Boolean);
    if (!saved) throw new Error(`no "saved" line for ${path.basename(file)}`);
    const [chunks, bytes] = [Number(saved[1]), Number(saved[2])];
    console.log(
      `  counted while recording: ${counted.chunkCount} chunks, ${counted.byteSize} bytes; joined into the file: ${chunks} chunks, ${bytes} bytes`,
    );
    if (counted.chunkCount !== chunks) {
      problems.push(`${counted.chunkCount} chunks counted, ${chunks} in the file`);
    }
    if (counted.byteSize !== bytes) {
      problems.push(`${counted.byteSize} bytes counted, ${bytes} in the file`);
    }
    const gap = lines.find((line) => line.includes('chunk sequence gap'));
    if (gap) problems.push(`a chunk is missing from the file: ${gap}`);
  } finally {
    await probe(page, 'settings:video-on');
  }

  const stray = strayChunksSchema.parse(await probe(page, 'store:put-stray-chunks'));
  await page.close();
  const control = await reloadExtension(browser, target);
  const startedAt = Date.now();
  const withChunks = async () =>
    recordingsWithChunksSchema.parse(await probe(control, 'store:recordings-with-chunks')).ids;
  // The recovery pass runs 30 s after the background starts.
  const deleted = await waitFor(
    'the stale stray chunks deleted',
    async () => !(await withChunks()).includes(stray.stale),
    60_000,
  ).catch(() => false);
  const left = await withChunks();
  const lines = (await backgroundDiagnostics(control)).filter(
    (line) => line.includes(stray.stale) || line.includes(stray.recent),
  );
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  console.log(
    `  ${((Date.now() - startedAt) / 1000).toFixed(1)} s after the background started: stale stray chunks ${left.includes(stray.stale) ? 'still stored' : 'deleted'}, recent ones ${left.includes(stray.recent) ? 'kept' : 'deleted'}`,
  );
  if (!deleted) {
    problems.push('chunks no recording was stored for, 25 h old, are still stored after the pass');
  }
  if (!left.includes(stray.recent)) {
    problems.push('chunks no recording was stored for, just stored, were deleted');
  }
  if (deleted && !lines.some((line) => line.includes(`deleted 2 chunks of ${stray.stale}`))) {
    problems.push('Diagnostics do not say that the stale stray chunks were deleted');
  }
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
