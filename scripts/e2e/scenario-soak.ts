/**
 * E2e scenario 92, on request only (`pnpm soak`, `E2E_SCENARIOS=92`, the weekly Soak workflow): one
 * long recording with video on a service's fake page. It runs for `SOAK_MINUTES` (10 by default;
 * the workflow records 120, a file of about 1 GB).
 *
 * It joins the call, records, and every minute reads:
 *   - the recorder's frame statistics;
 *   - the resident memory of the meeting page's process, of the extension's and of the browser's
 *     (`ChromeUtils.requestProcInfo` in the browser's chrome scope);
 *   - the page's chunks the extension has not taken yet;
 *   - the storage the extension uses.
 *
 * Then it hangs up and checks:
 *   - one file, not "(recovered)", with audio and video, as long as the recording;
 *   - its audio and video end within 1.25 s of each other: a picture that stopped changing (the
 *     call hung up, its tiles gone) is drawn once a second, so the video may end up to a second
 *     before the audio without any drift, while a drift grows with the recording;
 *   - every minute of it holds the frames the recorder aimed for, unless the recorder's own
 *     statistics say the machine was too busy (`judgeFrameSpan`);
 *   - one chunk every 3 s (the default timeslice), within 5 %;
 *   - the page's process grew by less than half and less than 256 MiB from the first tenth of the
 *     run (a minute at least) to its end;
 *   - once the file is saved, the store holds none of its chunks (within a minute: the store
 *     deletes them right after it marks the recording saved).
 * The storage the extension uses is in the report, not a check: Firefox's estimate counts the
 * IndexedDB files, which keep their size after a delete until the database is compacted.
 * Everything it measured goes to `.e2e/soak-<service>.json`.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { z } from 'zod';
import { readVideoTimeline } from '../bench/read-video-timeline';
import { evaluateInChrome } from './evaluate-in-chrome';
import {
  currentRecordingId,
  describeWebm,
  E2E_DIR,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  recordingStartedAt,
  sampleVideoStats,
  sleep,
  storedRecording,
  trackEnds,
  waitFor,
  waitForCompleteFile,
} from './harness';
import { type FrameSpanVerdict, judgeFrameSpan, type VideoStatsSample } from './judge-frame-span';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** How long the recording runs: `SOAK_MINUTES`, 10 by default. */
const soakMinutes = (): number =>
  z.coerce
    .number()
    .int()
    .positive()
    .parse(process.env['SOAK_MINUTES'] ?? '10');
const SAMPLE_MS = 60_000;
const MIB = 1024 * 1024;
/** The default timeslice: one chunk every 3 s. */
const CHUNK_S = 3;
/** A 1 GB file takes a minute or two to remux and save. */
const SAVE_TIMEOUT_MS = 15 * 60_000;
/** The video's heartbeat (one frame a second while nothing changes) and a quarter second. */
const MAX_DRIFT_S = 1.25;
const MAX_DURATION_ERROR_S = 3;
const MAX_CHUNK_ERROR = 0.05;
const MAX_GROWTH_SHARE = 0.5;
const MAX_GROWTH_BYTES = 256 * MIB;
/** What the extension may still keep once the file is saved: its metadata and its log. */
/** How long the store may take to delete a saved recording's chunks. */
const CHUNKS_GONE_TIMEOUT_MS = 60_000;

const procInfoSchema = z.object({
  memory: z.number(),
  children: z.array(
    z.object({ type: z.string(), memory: z.number(), windows: z.array(z.string()) }),
  ),
});
const storageSchema = z.object({ estimate: z.object({ usage: z.number() }) });
const storedChunksSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), storedChunks: z.number() })),
});
const backlogSchema = z.object({ backlog: z.object({ bytes: z.number() }).nullable() });

interface Sample {
  minute: number;
  video: VideoStatsSample;
  /** Resident memory (bytes) of the meeting page's process, the extension's and the browser's. */
  memory: { page: number; extension: number; browser: number };
  backlogBytes: number;
  storageBytes: number;
}

async function readMemory(browser: Browser, url: string): Promise<Sample['memory']> {
  const info = procInfoSchema.parse(
    JSON.parse(
      z
        .string()
        .parse(
          await evaluateInChrome(
            browser,
            'ChromeUtils.requestProcInfo().then((info) => JSON.stringify({ memory: info.memory, children: info.children.map((c) => ({ type: c.type, memory: c.memory, windows: (c.windows || []).map((w) => (w.documentURI && w.documentURI.spec) || "") })) }))',
          ),
        ),
    ),
  );
  const pageProcess = info.children.find((child) => child.windows.includes(url));
  const extension = info.children.find((child) => child.type === 'extension');
  return {
    page: pageProcess?.memory ?? 0,
    extension: extension?.memory ?? 0,
    browser: info.memory,
  };
}

const readStorage = async (page: Page): Promise<number> =>
  storageSchema.parse(await probe(page, 'opfs')).estimate.usage;

/** The recording's chunks still in the store, read until there are none or a minute passed. */
async function chunksLeft(page: Page, id: string): Promise<number> {
  const read = async () =>
    storedChunksSchema
      .parse(await probe(page, 'background:state'))
      .recordings.find((recording) => recording.id === id)?.storedChunks ?? 0;
  const deadline = Date.now() + CHUNKS_GONE_TIMEOUT_MS;
  let left = await read();
  while (left > 0 && Date.now() < deadline) {
    await sleep(1_000);
    left = await read();
  }
  return left;
}

async function takeSample(browser: Browser, page: Page, url: string, minute: number) {
  const debug = backlogSchema.safeParse(
    await page.evaluate(() => window.__zenRecorderPage?.debug()),
  );
  return {
    minute,
    video: await sampleVideoStats(page),
    memory: await readMemory(browser, url),
    backlogBytes: debug.success ? (debug.data.backlog?.bytes ?? 0) : 0,
    storageBytes: await readStorage(page),
  } satisfies Sample;
}

const mib = (bytes: number): string => `${(bytes / MIB).toFixed(0)} MiB`;

/** Records `minutes`, a sample a minute; returns the samples and when the recorder stopped. */
async function record(browser: Browser, page: Page, url: string, minutes: number) {
  const samples: Sample[] = [await takeSample(browser, page, url, 0)];
  for (let minute = 1; minute <= minutes; minute++) {
    await sleep(SAMPLE_MS);
    const sample = await takeSample(browser, page, url, minute);
    samples.push(sample);
    const { memory } = sample;
    console.log(
      `  minute ${minute}: page ${mib(memory.page)}, extension ${mib(memory.extension)}, browser ${mib(memory.browser)}, backlog ${mib(sample.backlogBytes)}, storage ${mib(sample.storageBytes)}`,
    );
  }
  const stoppedAt = await page.evaluate(async () => {
    window.__fixture.hangup();
    while (window.__zenRecorderPage?.snapshot().state === 'recording') {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Date.now();
  });
  return { samples, stoppedAt };
}

async function savedFile(page: Page, before: ReadonlySet<string>, id: string): Promise<string> {
  const file = await waitFor(
    'the saved file',
    async () => (await newRecordings(before))[0],
    SAVE_TIMEOUT_MS,
  );
  await waitForCompleteFile(file);
  await waitFor(
    'the recording saved',
    async () => (await storedRecording(page, id))?.status === 'saved',
    SAVE_TIMEOUT_MS,
  );
  return file;
}

interface Measures {
  file: string;
  webm: string;
  tracks: number;
  durationS: number;
  recordedS: number;
  ends: { audioS: number | null; videoS: number | null };
  frames: number;
  fps: number;
  minutes: Record<'ok' | 'overloaded' | 'stalled', number>;
  chunkCount: number;
  /** From the first tenth of the run (a minute at least) to its end. */
  pageGrowth: { fromMinute: number; fromBytes: number; bytes: number };
  /** The recording's chunks the store still held a minute after the save, at most. */
  chunksLeftAfterSave: number;
  storageAfterSaveBytes: number;
}

const inStep = ({ audioS, videoS }: Measures['ends']): boolean =>
  audioS !== null && videoS !== null && Math.abs(audioS - videoS) <= MAX_DRIFT_S;

function chunksOnTime(chunkCount: number, recordedS: number): boolean {
  const expected = recordedS / CHUNK_S;
  return Math.abs(chunkCount - expected) <= Math.max(2, MAX_CHUNK_ERROR * expected);
}

const grewTooMuch = ({ fromBytes, bytes }: Measures['pageGrowth']): boolean =>
  bytes > Math.max(MAX_GROWTH_BYTES, MAX_GROWTH_SHARE * fromBytes);

/** What failed, in words. */
function findProblems(measures: Measures, stalled: string[]): string[] {
  const checks: [boolean, string][] = [
    [!measures.file.includes('(recovered)'), 'saved as "(recovered)"'],
    [measures.tracks === 2, `${measures.tracks} track(s), not audio and video`],
    [
      Math.abs(measures.durationS - measures.recordedS) <= MAX_DURATION_ERROR_S,
      `the file lasts ${measures.durationS.toFixed(1)} s, the recording ${measures.recordedS.toFixed(1)} s`,
    ],
    [
      inStep(measures.ends),
      `audio ends at ${measures.ends.audioS} s, video at ${measures.ends.videoS} s`,
    ],
    [
      chunksOnTime(measures.chunkCount, measures.recordedS),
      `${measures.chunkCount} chunks for ${measures.recordedS.toFixed(0)} s, one every ${CHUNK_S} s expected`,
    ],
    [
      !grewTooMuch(measures.pageGrowth),
      `the page's process grew by ${mib(measures.pageGrowth.bytes)} from minute ${measures.pageGrowth.fromMinute} to the end`,
    ],
    [
      measures.chunksLeftAfterSave === 0,
      `the store still holds ${measures.chunksLeftAfterSave} of the recording's chunks once it is saved`,
    ],
  ];
  return [...checks.filter(([ok]) => !ok).map(([, problem]) => problem), ...stalled];
}

/** Reads the saved file and judges every minute's frames; returns the measures and the minutes. */
async function measure(input: {
  file: string;
  page: Page;
  id: string;
  samples: Sample[];
  startedAt: number;
  stoppedAt: number;
}): Promise<{ measures: Measures; spans: FrameSpanVerdict[] }> {
  const { file, samples } = input;
  const info = await inspectWebm(file);
  const frameTimes = (await readVideoTimeline(file, info.bytes)).frames.map((frame) => frame.t);
  const spans = samples.slice(1).map((to, index) => {
    const from = samples[index];
    if (!from) throw new Error('no sample before');
    const span = { label: `minute ${to.minute}`, from: from.video, to: to.video };
    return judgeFrameSpan({ ...span, startedAt: input.startedAt, frameTimes });
  });
  const minutes = { ok: 0, overloaded: 0, stalled: 0 };
  for (const span of spans) minutes[span.verdict]++;
  const early = samples[Math.max(1, Math.round(samples.length / 10))] ?? samples[0];
  const last = samples.at(-1);
  const fromBytes = early?.memory.page ?? 0;
  const measures: Measures = {
    file: path.basename(file),
    webm: describeWebm(info),
    tracks: info.tracks,
    durationS: info.durationS,
    recordedS: (input.stoppedAt - input.startedAt) / 1000,
    ends: await trackEnds(file),
    frames: frameTimes.length,
    fps: frameTimes.length / info.durationS,
    minutes,
    chunkCount: (await storedRecording(input.page, input.id))?.chunkCount ?? 0,
    pageGrowth: {
      fromMinute: early?.minute ?? 0,
      fromBytes,
      bytes: (last?.memory.page ?? fromBytes) - fromBytes,
    },
    chunksLeftAfterSave: await chunksLeft(input.page, input.id),
    storageAfterSaveBytes: await readStorage(input.page),
  };
  return { measures, spans };
}

export async function scenarioSoak({ browser, target }: ScenarioContext): Promise<void> {
  const minutes = soakMinutes();
  console.log(
    `▶ ${target.id} scenario 92: a ${minutes}-minute recording with video → one whole file, audio and video in step, steady frames, chunks and memory, its chunks deleted`,
  );
  const url = meetingUrl(target);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, url);
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 30_000);
  const startedAt = await recordingStartedAt(page);
  const { samples, stoppedAt } = await record(browser, page, url, minutes);
  const file = await savedFile(page, before, id);
  const { measures, spans } = await measure({ file, page, id, samples, startedAt, stoppedAt });
  console.log(`  saved: ${JSON.stringify(measures)}`);
  const stalled = spans.filter((span) => span.verdict === 'stalled').map((span) => span.summary);
  const problems = findProblems(measures, stalled);
  const report = path.join(E2E_DIR, `soak-${target.id}.json`);
  const minuteSummaries = spans.map((span) => span.summary);
  const all = { minutes, problems, measures, frameSpans: minuteSummaries, samples };
  await writeFile(report, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`  everything it measured: ${path.relative(process.cwd(), report)}`);
  await page.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
