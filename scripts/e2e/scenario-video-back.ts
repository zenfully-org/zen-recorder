/**
 * E2e scenario 62, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * extension takes no chunk until a recording with video fills the page's backlog limit (lowered
 * here), so the meeting goes on audio only; then the extension takes chunks again → once it has
 * taken the video recording, and keeps up with the audio one, the page stops the audio-only
 * recording and records with video again. Three files: with video, audio only, with video.
 * Before, the video stayed off for the rest of the meeting.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  describeWebm,
  inspectWebm,
  openMeeting,
  pageDiagnostics,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** Small enough for the fixture's video to fill it in about 30 s. */
const LIMIT_BYTES = 2 * 2 ** 20;

const savedSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), filename: z.string().optional() }),
  ),
});

const runningSchema = z.object({
  id: z.string().nullable(),
  debug: z.object({ video: z.unknown().nullable() }),
});

export async function scenarioVideoBack({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 62: a recording with video fills the page's backlog, then the extension takes it → the video comes back`,
  );
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const lowered = await page.evaluate(
    (bytes) => window.__zenRecorderPage?.setBacklogLimit?.(bytes)?.backlogLimitBytes ?? null,
    LIMIT_BYTES,
  );
  if (lowered !== LIMIT_BYTES) throw new Error("this build cannot lower the page's backlog limit");
  /** The recording that runs, and whether it has video. */
  const running = async () => {
    const now = runningSchema.parse(
      await page.evaluate(() => ({
        id: window.__zenRecorderPage?.snapshot().recordingId ?? null,
        debug: window.__zenRecorderPage?.debug(),
      })),
    );
    return { id: now.id, withVideo: now.debug.video !== null };
  };
  /** Waits for a recording other than `others` that has video, or not. */
  const nextRecording = (label: string, withVideo: boolean, others: string[], timeoutMs: number) =>
    waitFor(
      label,
      async () => {
        const now = await running();
        return now.id && !others.includes(now.id) && now.withVideo === withVideo ? now.id : null;
      },
      timeoutMs,
    );
  await page.click('#start');
  const video = await nextRecording('a recording with video', true, [], 20_000);
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  const audio = await nextRecording('audio only once the video filled it', false, [video], 120_000);
  console.log(`  ${video} filled the backlog; ${audio} records audio only`);
  await sleep(4_000);
  const releasedAt = Date.now();
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  const back = await nextRecording('a recording with video again', true, [video, audio], 60_000);
  console.log(
    `  ${((Date.now() - releasedAt) / 1000).toFixed(1)} s after the release, ${back} records with video again`,
  );
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  /** The file recording `id` was saved as, once it is saved. */
  const savedAs = async (id: string) => {
    const { recordings } = savedSchema.parse(await probe(page, 'background:state'));
    const recording = recordings.find((candidate) => candidate.id === id);
    return recording?.status === 'saved' ? recording.filename : null;
  };
  const files = await Promise.all(
    [video, audio, back].map((id) => waitFor(`${id} saved`, () => savedAs(id), 60_000)),
  );
  let withVideo = 0;
  for (const file of files) {
    const info = await inspectWebm(await waitForCompleteFile(file));
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    if (info.video) withVideo++;
  }
  const lines = await pageDiagnostics(page, since);
  for (const line of lines.filter((l) => /backlog|recording ended|video again/.test(l))) {
    console.log(`  diagnostics: ${line}`);
  }
  const problems: string[] = [];
  if (withVideo !== 2) problems.push(`${withVideo} files with video, not 2`);
  if (!lines.some((line) => line.includes('recording ended (video-back)'))) {
    problems.push('the audio-only recording did not end to bring the video back');
  }
  const gap = (await backgroundDiagnostics(page)).find((line) => line.includes('sequence gap'));
  if (gap) problems.push(`a chunk is missing from a file: ${gap}`);
  await page.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
