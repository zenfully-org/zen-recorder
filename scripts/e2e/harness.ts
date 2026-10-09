/**
 * Shared plumbing for the end-to-end run: paths, the browser launch, the fixture-page contract and
 * helpers to wait for things and to inspect the saved files. Imported by `scripts/e2e-fixture.ts`
 * and `scripts/e2e/scenarios.ts`; not runnable on its own.
 *
 * THE FIXTURE CONTRACT. Every provider has a fake page under `src/test/fixtures/fake-<id>.html`
 * that mimics the real service's DOM and media plumbing closely enough for its provider code to
 * work unchanged, and exposes the same driver API, so one set of scenarios runs against all of
 * them:
 *   - a `#start` button that joins the call (a real click gives the page user activation),
 *   - `window.__fixture` implementing `FixtureApi` below,
 *   - in a call: the user's own tile plus one remote participant (a 440 Hz tone + moving video),
 *     and `toggleShare()` adds/removes a screen-share tile; the microphone is Firefox's fake one
 *     (a 1 kHz tone), so the two can be told apart in a saved file (`toneLevel`),
 *   - optionally the host's side, opened at `FixtureTarget.hostMeetingPath`: `#start` joins the
 *     host alone, `knock()` puts a guest in the waiting room and `letIn()` admits them.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { z } from 'zod';
import { firefoxForPlatform } from './firefox-for-platform';
import type { VideoStatsSample } from './judge-frame-span';

export const ROOT = path.resolve(import.meta.dirname, '../..');
/** The built extension; `E2E_EXTENSION_DIR` points at another build (A/B benchmarks). */
export const EXTENSION_DIR =
  process.env['E2E_EXTENSION_DIR'] ?? path.join(ROOT, '.output/firefox-mv3');
/** The browser: `E2E_FIREFOX`, else the one `pnpm setup:firefox` put under `.tools/`. */
export const FIREFOX =
  process.env['E2E_FIREFOX'] ??
  path.join(ROOT, '.tools', firefoxForPlatform(process.platform, process.arch).executable);
/** What a run leaves: the saved files, and the Diagnostics log of a service whose run failed. */
export const E2E_DIR = path.join(ROOT, '.e2e');
export const DOWNLOAD_DIR = path.join(E2E_DIR, 'downloads');
// Not 4173: that is the port of `pnpm fixture`, which may be serving a browser driven by hand.
export const PORT = Number(process.env['E2E_FIXTURE_PORT'] ?? 4175);

const builtManifestSchema = z.object({ version: z.string(), description: z.string() });

/** What the run needs from the built extension's manifest. */
export function builtManifest(): z.infer<typeof builtManifestSchema> {
  const file = path.join(EXTENSION_DIR, 'manifest.json');
  return builtManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface FixtureApi {
  /** Joins the call (same as clicking `#start`). */
  start(): Promise<void>;
  /** Renames the meeting wherever the provider reads its title (tab title, topic). */
  setTitle(title: string): void;
  /** Ends the call the way the service does when the user hangs up (media stops, UI leaves). */
  hangup(): void;
  mute(): void;
  unmute(): void;
  /** Hangs up and navigates to a non-meeting route of the service. */
  leave(): void;
  /** Starts/stops a remote screen share. */
  toggleShare(): void;
  /**
   * A settings dialog's microphone test: opens a second microphone next to the call's and stops
   * it (no event) after `holdMs`, 2 s by default. Resolves once it is stopped.
   */
  micTest(holdMs?: number): Promise<void>;
  /** Number of video tiles currently showing. */
  tileCount(): number;
  /**
   * The host's side only (`FixtureTarget.hostMeetingPath`): a guest enters the waiting room, and
   * the host lets them in. Fake pages without a host side leave both out.
   */
  knock?(): void;
  letIn?(): void;
  /** Runs a background diagnostic through the extension's debug bridge (e2e builds only). */
  probe(name: string): Promise<unknown>;
  /** The recorder's status card, read from its shadow root; null until it is mounted. */
  overlayState(): { state?: string; visible?: string; text?: string } | null;
  /** Clicks a button of the status card by its label ('Record', 'Stop', …), open or not. */
  clickOverlay(name: string): boolean;
}

declare global {
  interface Window {
    __fixture: FixtureApi;
    /** The MediaRecorders the page started, once `trackMediaRecorders` ran. */
    __e2eRecorders?: MediaRecorder[];
    /** Set by `dropPortOnNextEnd` once the held end notice was posted with the Port down. */
    __e2eEndReleased?: boolean;
    /** How many end notices the page posted since `dropPortOnNextEnd` ran. */
    __e2eEndNotices?: number;
    /** Every toast the recorder's overlay showed since `watchToasts` ran. */
    __e2eToasts?: { kind: string; text: string }[];
    __zenRecorderPage?: {
      snapshot(): {
        state: string;
        recordingId: string | null;
        recordingStartedAt: number | null;
        provider: string;
        micLabel: string | null;
      };
      debug(): unknown;
      /** How many bytes of unacked chunks the recordings started from now on may hold. */
      setBacklogLimit?(bytes: number): { backlogLimitBytes: number };
    };
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${label}`);
}

export function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export async function overlayState(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__fixture?.overlayState()?.state);
}

/** True once the encoder actually started (the card says Recording while the probe still runs). */
export async function recordingStarted(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingId != null);
}

export async function probe(page: Page, name: string): Promise<unknown> {
  return page.evaluate((n) => window.__fixture.probe(n), name);
}

/** The recording the page session is writing now (e2e builds expose the session). */
export async function currentRecordingId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingId ?? null);
}

/** Remembers every MediaRecorder the page starts from now on, so a run can make one fail. */
export async function trackMediaRecorders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const started: MediaRecorder[] = [];
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (this: MediaRecorder, timeslice?: number) {
      started.push(this);
      start.call(this, timeslice);
    };
    window.__e2eRecorders = started;
  });
}

/** Fires an `error` event on the last MediaRecorder the page started, as a broken encoder would. */
export async function failLastMediaRecorder(page: Page, message: string): Promise<void> {
  await page.evaluate((text) => {
    const recorder = window.__e2eRecorders?.at(-1);
    if (!recorder) throw new Error('no MediaRecorder was started');
    recorder.dispatchEvent(Object.assign(new Event('error'), { error: new Error(text) }));
  }, message);
}

/**
 * Makes every `VideoEncoder.encode` in the page throw from now on, as a lost GPU or a broken
 * encoder does: the recorder's next video frame fails. Returns the page's clock at that moment.
 */
export async function failVideoEncoder(page: Page, message: string): Promise<number> {
  return z.number().parse(
    await page.evaluate((text) => {
      VideoEncoder.prototype.encode = function (): void {
        throw new DOMException(text, 'EncodingError');
      };
      return Date.now();
    }, message),
  );
}

/**
 * Makes the Port drop while the page's next end notice (`page:recordingEnded`) is on its way, as an
 * event page that restarts at that moment does. The notice is held, the background
 * disconnects every tab's Port from its side (it does not notice, like a fresh event page), and the
 * notice is posted 100 ms later, while the bridge still waits its 1 s to reconnect. Every later
 * message goes through untouched. `window.__e2eEndReleased` turns true once the notice is posted,
 * and `window.__e2eEndNotices` counts the end notices the page posts.
 */
export async function dropPortOnNextEnd(page: Page): Promise<void> {
  // No named function inside the page: tsx would wrap it in a helper the page lacks.
  await page.evaluate(() => {
    const original = window.postMessage;
    let armed = true;
    const descriptor: PropertyDescriptor = { configurable: true, writable: true };
    descriptor.value = (...args: unknown[]) => {
      const message: unknown = args[0];
      const isEndNotice =
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'req' &&
        'type' in message &&
        message.type === 'page:recordingEnded';
      if (isEndNotice) window.__e2eEndNotices = (window.__e2eEndNotices ?? 0) + 1;
      if (!armed || !isEndNotice) return Reflect.apply(original, window, args);
      armed = false;
      void window.__fixture.probe('ports:disconnect').then(() =>
        setTimeout(() => {
          Reflect.apply(original, window, args);
          window.__e2eEndReleased = true;
        }, 100),
      );
      return undefined;
    };
    // The recorder's messenger looks `postMessage` up on the window at every call.
    Object.defineProperty(window, 'postMessage', descriptor);
  });
}

const videoStatsSchema = z.object({
  at: z.number(),
  debug: z.object({
    video: z.object({
      fps: z.number(),
      ticks: z.number(),
      busyTicks: z.number(),
      sums: z.object({
        find: z.number(),
        layout: z.number(),
        draw: z.number(),
        frame: z.number(),
        encode: z.number(),
      }),
    }),
  }),
});

/**
 * The recorder's video statistics now, for `judgeFrameSpan`; fails when no recording with video
 * runs. The time is the page's own, read with the statistics: under load the round trip to the
 * page can take seconds.
 */
export async function sampleVideoStats(page: Page): Promise<VideoStatsSample> {
  const { at, debug } = videoStatsSchema.parse(
    await page.evaluate(() => ({ at: Date.now(), debug: window.__zenRecorderPage?.debug() })),
  );
  const { video } = debug;
  const { find, layout, draw, frame, encode } = video.sums;
  return {
    at,
    fps: video.fps,
    ticks: video.ticks,
    busyTicks: video.busyTicks,
    mainMs: find + layout + draw + frame + encode,
  };
}

/** When the recording the page writes now started (epoch ms): time zero of its file. */
export async function recordingStartedAt(page: Page): Promise<number> {
  return z
    .number()
    .parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt));
}

const diagnosticsSchema = z.array(
  z.object({ at: z.number(), level: z.string(), source: z.string(), message: z.string() }),
);

/**
 * Lines of the persisted diagnostics log (what the popup's Diagnostics button copies), from
 * `since` (epoch ms) on: the log is the browser's, so it holds earlier scenarios' lines too.
 */
async function diagnostics(
  page: Page,
  source: 'page' | 'background',
  since: number,
): Promise<string[]> {
  const entries = diagnosticsSchema.safeParse(await probe(page, 'diagnostics'));
  if (!entries.success) return ['(this build has no diagnostics probe)'];
  return entries.data
    .filter((entry) => entry.source.startsWith(source) && entry.at >= since)
    .map(
      (entry) =>
        `${new Date(entry.at).toISOString().slice(11, 23)} ${entry.level}: ${entry.message}`,
    );
}

/**
 * Writes the extension's whole Diagnostics log (what the popup's Diagnostics button copies) to
 * `file`, read through a meeting page opened for it: what a failed run leaves for the person who
 * looks into it. It never throws; it says what it did, or why it could not.
 */
export async function saveDiagnostics(
  browser: Browser,
  url: string,
  file: string,
): Promise<string> {
  let page: Page | null = null;
  try {
    page = await openMeeting(browser, url);
    const entries = diagnosticsSchema.parse(await probe(page, 'diagnostics'));
    await writeFile(file, `${JSON.stringify(entries, null, 2)}\n`);
    return `diagnostics: ${entries.length} lines saved to ${path.relative(ROOT, file)}`;
  } catch (error) {
    return `diagnostics: not saved (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/** The page's lines of the diagnostics log, from `since` (epoch ms) on. */
export const pageDiagnostics = (page: Page, since = 0): Promise<string[]> =>
  diagnostics(page, 'page', since);

/** The background's lines of the diagnostics log (saves, failures, warnings). */
export const backgroundDiagnostics = (page: Page): Promise<string[]> =>
  diagnostics(page, 'background', 0);

const receivedCspReportsSchema = z.array(z.object({ receivedAt: z.number(), body: z.string() }));
/** The fields of a `report-uri` report a run looks at; Firefox leaves out what does not apply. */
const cspReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().default(''),
    'blocked-uri': z.string().default(''),
    'effective-directive': z.string().default(''),
    'script-sample': z.string().default(''),
  }),
});

export interface CspReport {
  documentUri: string;
  /** `eval` for code built from a string under `script-src`, else a URL or a keyword. */
  blockedUri: string;
  directive: string;
  /** For a Trusted Types sink: the sink, `|`, and the start of the value (`Function|(a) {…`). */
  sample: string;
}

/**
 * The Content Security Policy reports the fake meeting pages sent the fixture server from `since`
 * (epoch ms) on: what a service whose policy forbids eval would have been told.
 */
export async function cspReports(since: number): Promise<CspReport[]> {
  const response = await fetch(`http://localhost:${PORT}/csp-reports`);
  return receivedCspReportsSchema
    .parse(await response.json())
    .filter((received) => received.receivedAt >= since)
    .map(({ body }) => {
      const report = cspReportSchema.parse(JSON.parse(body))['csp-report'];
      return {
        documentUri: report['document-uri'],
        blockedUri: report['blocked-uri'],
        directive: report['effective-directive'],
        sample: report['script-sample'],
      };
    });
}

/** Opens the page and waits until the fixture API and the recorder's overlay are both there. */
export async function openMeeting(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('zen-recorder') || text.includes('[fixture]'))
      console.log(`  [page] ${text}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await waitFor(
    'fixture api',
    () => page.evaluate(() => typeof window.__fixture === 'object'),
    10_000,
  );
  await waitFor(
    'overlay mounted',
    () => page.evaluate(() => window.__fixture.overlayState() !== null),
    10_000,
  );
  return page;
}

const toastsSchema = z.array(z.object({ kind: z.string(), text: z.string() }));

/** Records every toast the recorder's overlay shows from now on: a toast leaves after 8 s. */
export async function watchToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const toasts = document
      .querySelector('zen-recorder-overlay')
      ?.shadowRoot?.querySelector('.zr-toasts');
    if (!toasts) throw new Error('the overlay has no toast area');
    const seen: { kind: string; text: string }[] = [];
    window.__e2eToasts = seen;
    new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (node instanceof HTMLElement) {
          seen.push({ kind: node.dataset['kind'] ?? '', text: node.textContent ?? '' });
        }
      }
    }).observe(toasts, { childList: true });
  });
}

/** The toasts the overlay showed since `watchToasts` ran. */
export const toastsOf = async (page: Page): Promise<{ kind: string; text: string }[]> =>
  toastsSchema.parse(await page.evaluate(() => window.__e2eToasts ?? []));

export async function listWebm(): Promise<string[]> {
  if (!existsSync(DOWNLOAD_DIR)) return [];
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.webm') ? [full] : [];
      }),
    );
    return nested.flat();
  };
  return walk(DOWNLOAD_DIR);
}

/** Files saved since `before` was taken, without the optional raw copies. */
export async function newRecordings(before: ReadonlySet<string>): Promise<string[]> {
  return (await listWebm()).filter((file) => !before.has(file) && !file.includes(' raw.'));
}

/** Bytes of a finished download, or null while Firefox is still writing it (`.part` sibling). */
async function completedSize(file: string): Promise<number | null> {
  if (existsSync(`${file}.part`) || !existsSync(file)) return null;
  const { size } = await stat(file);
  return size > 0 ? size : null;
}

/**
 * Resolves once the download of `file` has finished: Firefox creates the target file empty and
 * fills it at the end, so a file that merely exists may still be unreadable.
 */
export async function waitForCompleteFile(file: string): Promise<string> {
  let previous: number | null = null;
  return waitFor(
    `complete file ${path.basename(file)}`,
    async () => {
      const size = await completedSize(file);
      const stable = size !== null && size === previous;
      previous = size;
      return stable ? file : null;
    },
    30_000,
  );
}

/** The first recording saved since `before` was taken, once it is completely written. */
export async function waitForNewRecording(
  before: ReadonlySet<string>,
  matches: (file: string) => boolean = () => true,
): Promise<string> {
  const file = await waitFor(
    'saved file',
    async () => (await newRecordings(before)).find(matches),
    60_000,
  );
  return waitForCompleteFile(file);
}

export function ffprobe(file: string): string {
  try {
    return execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size:stream=codec_name,sample_rate,channels',
        '-of',
        'compact',
        file,
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .replace(/\n/g, ' | ');
  } catch (error) {
    return `ffprobe unavailable/failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * RMS level (dBFS) of `file`'s audio around `frequencyHz`, between `fromS` and `toS` seconds of
 * its timeline: two narrow band-pass stages keep a tone and drop the fixtures' other tone (440 Hz
 * against the fake microphone's 1 kHz, about 50 dB down). `-Infinity` for digital silence.
 */
export function toneLevel(file: string, frequencyHz: number, fromS: number, toS: number): number {
  const band = `bandpass=f=${frequencyHz}:t=q:w=10`;
  // astats writes its summary to stderr.
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-nostats', '-v', 'info'],
      ...['-ss', String(fromS), '-t', String(toS - fromS), '-i', file],
      ...['-map', '0:a:0', '-af', `${band},${band},astats=measure_perchannel=none`],
      ...['-f', 'null', '-'],
    ],
    { encoding: 'utf8' },
  );
  const level = /RMS level dB: (-inf|-?[\d.]+)/.exec(stderr)?.[1];
  if (level === undefined) throw new Error(`no audio level from ffmpeg for ${file}: ${stderr}`);
  return level === '-inf' ? Number.NEGATIVE_INFINITY : Number(level);
}

/** Where each track of a saved file ends, in seconds (null when the file has no such track). */
export async function trackEnds(
  file: string,
): Promise<{ audioS: number | null; videoS: number | null }> {
  const input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS });
  try {
    const audio = await input.getPrimaryAudioTrack();
    const video = await input.getPrimaryVideoTrack();
    return {
      audioS: audio ? await audio.computeDuration() : null,
      videoS: video ? await video.computeDuration() : null,
    };
  } finally {
    input.dispose();
  }
}

/** ffmpeg's analysis of the file's audio through `filter` (what it prints on stderr). */
function analyseAudio(file: string, filter: string, window: string[] = []): string {
  const run = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', ...window, '-i', file, '-vn', '-af', filter, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${run.stderr}`);
  return run.stderr;
}

/** Silent stretches of the audio (below -50 dBFS for at least `minS`), as [start, duration] in s. */
export function silences(file: string, minS: number): [number, number][] {
  const output = analyseAudio(file, `silencedetect=noise=-50dB:d=${minS}`);
  return [...output.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map(
    (match) => {
      const duration = Number(match[2]);
      return [Number((Number(match[1]) - duration).toFixed(2)), duration];
    },
  );
}

/**
 * RMS level (dBFS) of every `stepS` slice of the audio between `fromS` and `toS`, in order:
 * the level over time, so a stretch without sound shows where it is. `-Infinity` for digital
 * silence; a span past the end of the audio has no slices. The span is cut from the decoded
 * audio: seeking the input would start at a video key frame, after any audio before it.
 */
export function levelsOverTime(file: string, fromS: number, toS: number, stepS: number): number[] {
  const samples = Math.round(stepS * 48_000);
  const output = analyseAudio(
    file,
    `aresample=48000,atrim=start=${fromS}:end=${toS},asetnsamples=n=${samples}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
  );
  return [...output.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-inf|-?[\d.]+)/g)].map((match) =>
    match[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number(match[1]),
  );
}

/** Mean level of the audio between `fromS` and `toS` in dBFS; null when that span has no audio. */
export function meanVolume(file: string, fromS: number, toS: number): number | null {
  const output = analyseAudio(file, 'volumedetect', ['-ss', `${fromS}`, '-t', `${toS - fromS}`]);
  const level = /mean_volume: (-?[\d.]+) dB/.exec(output)?.[1];
  return level === undefined ? null : Number(level);
}

export interface WebmInfo {
  bytes: number;
  durationS: number;
  tracks: number;
  video: { codec: string | null; width: number; height: number; frames: number } | null;
}

export async function inspectWebm(file: string): Promise<WebmInfo> {
  const bytes = (await stat(file)).size;
  const input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS });
  try {
    const durationS = await input.computeDuration();
    const tracks = (await input.getTracks()).length;
    const videoTrack = await input.getPrimaryVideoTrack();
    const video = videoTrack
      ? {
          codec: videoTrack.codec,
          width: videoTrack.codedWidth,
          height: videoTrack.codedHeight,
          frames: (await videoTrack.computePacketStats()).packetCount,
        }
      : null;
    return { bytes, durationS, tracks, video };
  } finally {
    input.dispose();
  }
}

export function describeWebm(info: WebmInfo): string {
  const video = info.video
    ? `, video ${info.video.codec} ${info.video.width}x${info.video.height} ${info.video.frames} frames`
    : '';
  return `${info.bytes} bytes, ${info.durationS.toFixed(1)} s, ${info.tracks} track(s)${video}`;
}

/** Socket of the private test audio server (`scripts/test-audio.sh`). */
const TEST_AUDIO_SOCKET = path.join(
  (process.env['XDG_RUNTIME_DIR'] ?? `/run/user/${process.getuid?.() ?? 1000}`).replace(/\/$/, ''),
  'zen-recorder-pulse/native',
);

/**
 * Chooses the audio server for the browsers: `E2E_PULSE_SERVER` when given, else the private test
 * server when it is up, else whatever the environment already says (WSLg's server under WSL2). It
 * has to be this process's environment: an explicit `env` for `puppeteer.launch` made recordings
 * silent.
 */
export function selectAudioServer(): string {
  const chosen =
    process.env['E2E_PULSE_SERVER'] ??
    (existsSync(TEST_AUDIO_SOCKET) ? `unix:${TEST_AUDIO_SOCKET}` : process.env['PULSE_SERVER']);
  if (chosen) process.env['PULSE_SERVER'] = chosen;
  return chosen ?? 'system default';
}

/**
 * Fails fast when the browser cannot run its audio graph (no usable audio output: on WSL2 the
 * WSLg PulseAudio server sometimes refuses connections). Without it every AudioContext stays
 * suspended, recordings have no audio and the scenarios fail in misleading ways.
 */
export async function assertAudioWorks(browser: Browser, url: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'load' });
    const running = await page.evaluate(`(async () => {
      const context = new AudioContext();
      for (let i = 0; i < 40 && !(context.state === 'running' && context.currentTime > 0); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const ok = context.state === 'running' && context.currentTime > 0;
      await context.close();
      return ok;
    })()`);
    if (running !== true) {
      throw new Error(
        'the browser cannot play audio, so nothing can be recorded: start the private audio ' +
          'server with `scripts/test-audio.sh start` (`setup` once) and run again',
      );
    }
  } finally {
    await page.close();
  }
}

export async function launch(): Promise<Browser> {
  return puppeteer.launch({
    browser: 'firefox',
    executablePath: FIREFOX,
    headless: process.env['E2E_HEADLESS'] !== '0',
    enableExtensions: true,
    extraPrefsFirefox: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
      'permissions.default.camera': 1,
      'permissions.default.microphone': 1,
      'xpinstall.signatures.required': false,
      'media.autoplay.default': 0,
      'media.autoplay.blocking_policy': 0,
      'media.autoplay.block-webaudio': false,
      'browser.download.dir': DOWNLOAD_DIR,
      'browser.download.folderList': 2,
      'browser.download.useDownloadDir': true,
      'browser.download.alwaysOpenPanel': false,
      'browser.download.manager.showWhenStarting': false,
    },
  });
}
