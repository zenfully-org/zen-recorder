/**
 * Recording benchmark: drives every provider's fixture page through the e2e harness in a "bench"
 * mode (a 1920x1080 screen share plus 15 fps cameras, or still ones in the `static` profile; see
 * `?bench=` in the fixture pages) and
 * measures what a recording costs, per phase (share on, tab visible; share on, tab hidden):
 *   - frames delivered vs nominal, read from the saved file's own timeline (works for any build),
 *   - the recorder's own statistics when the build reports them (`__zenRecorderPage.debug().video`):
 *     main-thread ms per frame split into find / layout / draw / VideoFrame / encode, backpressure
 *     wait, encoder queue, unchanged and busy ticks, the frame rate the controller chose,
 *   - event-loop lag of the page (a 50 ms interval probe: p95, max, ticks later than 50 ms),
 *   - CPU time of the browser's processes from /proc (cores used: all, busiest content process),
 *   - audio repairs ("filled with silence" lines) and rate changes from the page log,
 *   - bytes per minute of the saved file.
 * Timing numbers are only meaningful while no other Firefox runs on the machine (checked; set
 * BENCH_FORCE=1 to run anyway) and the run holds the browser lock, in the folder that holds the
 * working copies side by side, so that one run at a time launches Firefox:
 *   flock ../.browser.lock pnpm bench
 * Env: BENCH_PROVIDERS=meet,zoom,teams · BENCH_PROFILES=motion,slides (also: static) · BENCH_SECONDS=20 (per
 * phase) · BENCH_SHARE=0 (no screen share) · BENCH_LABEL=baseline (name of the result file in .e2e/bench/) · BENCH_FORCE=1 ·
 * E2E_EXTENSION_DIR=<another build>/firefox-mv3 to measure another version on the same fixtures
 * (A/B). `pnpm bench:run` skips the build.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { z } from 'zod';
import { foreignFirefoxPids, readProcessCpu } from './bench/read-process-cpu';
import { framesInWindow, readVideoTimeline } from './bench/read-video-timeline';
import {
  assertAudioWorks,
  EXTENSION_DIR,
  launch,
  listWebm,
  openMeeting,
  overlayState,
  PORT,
  ROOT,
  recordingStarted,
  selectAudioServer,
  sleep,
  waitFor,
  waitForNewRecording,
} from './e2e/harness';
import { type FixtureTarget, meetingUrl, selectTargets } from './e2e/targets';
import { startFixtureServer } from './fixture-server';

const PHASE_S = Number(process.env['BENCH_SECONDS'] ?? 20);
const WARMUP_S = 5;
const LABEL = process.env['BENCH_LABEL'] ?? 'run';
const PROFILES = (process.env['BENCH_PROFILES'] ?? 'motion,slides')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const NOMINAL_FPS = 15;
/** BENCH_SHARE=0 records the call without the screen share (the camera tiles only). */
const WITH_SHARE = process.env['BENCH_SHARE'] !== '0';

const phaseMs = z.object({
  find: z.number(),
  layout: z.number(),
  draw: z.number(),
  frame: z.number(),
  encode: z.number(),
  wait: z.number(),
});
/** What a build with pipeline statistics reports; older builds report nothing. */
const videoStatsSchema = z.object({
  fps: z.number(),
  ticks: z.number(),
  busyTicks: z.number(),
  unchanged: z.number(),
  encoded: z.number(),
  sums: phaseMs,
  p95: phaseMs.extend({ total: z.number() }),
});
type VideoStats = z.infer<typeof videoStatsSchema>;
const debugSchema = z.object({ video: videoStatsSchema.nullish() });
const snapshotSchema = z.object({ recordingStartedAt: z.number().nullable() });
const lagSchema = z.array(z.number());

interface Sample {
  at: number;
  cpu: Map<number, { kind: string; cpuS: number }>;
  video: VideoStats | null;
  lags: number[];
}

const LAG_PROBE = `(() => {
  if (window.__benchLag) return;
  const lags = [];
  let last = performance.now();
  setInterval(() => { const now = performance.now(); lags.push(now - last - 50); last = now; }, 50);
  window.__benchLag = { take: () => lags.splice(0) };
})()`;

async function sample(page: Page, rootPid: number): Promise<Sample> {
  const debug = debugSchema.safeParse(
    await page.evaluate(() => window.__zenRecorderPage?.debug() ?? {}),
  );
  const lags = lagSchema.safeParse(await page.evaluate('window.__benchLag?.take() ?? []'));
  const cpu = new Map(
    readProcessCpu(rootPid).map((p) => [p.pid, { kind: p.kind, cpuS: p.cpuS }] as const),
  );
  return {
    at: Date.now(),
    cpu,
    video: debug.success ? (debug.data.video ?? null) : null,
    lags: lags.success ? lags.data : [],
  };
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
};
const round = (value: number, digits = 1): number => Number(value.toFixed(digits));

function cpuBetween(from: Sample, to: Sample) {
  const seconds = (to.at - from.at) / 1000;
  const deltas = [...to.cpu].map(([pid, now]) => ({
    kind: now.kind,
    cpuS: now.cpuS - (from.cpu.get(pid)?.cpuS ?? 0),
  }));
  const total = deltas.reduce((sum, d) => sum + d.cpuS, 0);
  const tabs = deltas.filter((d) => d.kind === 'tab').map((d) => d.cpuS);
  const byKind: Record<string, number> = {};
  for (const d of deltas) byKind[d.kind] = round((byKind[d.kind] ?? 0) + d.cpuS / seconds, 2);
  return {
    cores: round(total / seconds, 2),
    busiestTab: round(Math.max(0, ...tabs) / seconds, 2),
    byKind,
  };
}

function videoBetween(from: VideoStats | null, to: VideoStats | null, seconds: number) {
  if (!from || !to) return null;
  const encoded = to.encoded - from.encoded;
  const per = (key: keyof VideoStats['sums']) =>
    round((to.sums[key] - from.sums[key]) / Math.max(1, encoded), 2);
  const mainMs =
    to.sums.find +
    to.sums.layout +
    to.sums.draw +
    to.sums.frame +
    to.sums.encode -
    (from.sums.find + from.sums.layout + from.sums.draw + from.sums.frame + from.sums.encode);
  return {
    fpsTarget: to.fps,
    encodedFps: round(encoded / seconds),
    ticksPerS: round((to.ticks - from.ticks) / seconds),
    busyTicksPerS: round((to.busyTicks - from.busyTicks) / seconds),
    unchangedPerS: round((to.unchanged - from.unchanged) / seconds),
    meanMsPerFrame: {
      find: per('find'),
      layout: per('layout'),
      draw: per('draw'),
      frame: per('frame'),
      encode: per('encode'),
      wait: per('wait'),
    },
    mainThreadMsPerS: round(mainMs / seconds),
    p95: to.p95,
  };
}

interface PhaseResult {
  phase: string;
  seconds: number;
  file: ReturnType<typeof framesInWindow>;
  video: ReturnType<typeof videoBetween>;
  lag: { p95: number; max: number; over50: number };
  cpu: ReturnType<typeof cpuBetween>;
  logs: { silence: number; rateChanges: number };
}

function phaseResult(
  phase: string,
  from: Sample,
  to: Sample,
  timeline: Awaited<ReturnType<typeof readVideoTimeline>>,
  startedAt: number,
  logs: { at: number; text: string }[],
): PhaseResult {
  const seconds = (to.at - from.at) / 1000;
  const inPhase = logs.filter((line) => line.at >= from.at && line.at < to.at);
  return {
    phase,
    seconds: round(seconds),
    file: framesInWindow(timeline, (from.at - startedAt) / 1000, (to.at - startedAt) / 1000),
    video: videoBetween(from.video, to.video, seconds),
    lag: {
      p95: round(percentile(to.lags, 0.95)),
      max: round(Math.max(0, ...to.lags)),
      over50: to.lags.filter((lag) => lag > 50).length,
    },
    cpu: cpuBetween(from, to),
    logs: {
      silence: inPhase.filter((line) => line.text.includes('filled with silence')).length,
      rateChanges: inPhase.filter((line) => line.text.includes('video rate')).length,
    },
  };
}

async function benchOne(browser: Browser, target: FixtureTarget, profile: string) {
  const rootPid = browser.process()?.pid ?? 0;
  const url = new URL(meetingUrl(target));
  url.searchParams.set('bench', profile);
  console.log(`\n▶ ${target.id} / ${profile}: ${url.pathname}${url.search.slice(0, 40)}…`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, url.toString());
  const logs: { at: number; text: string }[] = [];
  page.on('console', (message) => logs.push({ at: Date.now(), text: message.text() }));
  await page.click('#start');
  await waitFor('recording', async () => (await overlayState(page)) === 'recording', 20_000);
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  await waitFor(
    'call tiles',
    async () => (await page.evaluate(() => window.__fixture.tileCount())) === target.tiles.call,
    10_000,
  );
  if (WITH_SHARE) {
    await page.evaluate(() => window.__fixture.toggleShare());
    await waitFor(
      'share tile',
      async () =>
        (await page.evaluate(() => window.__fixture.tileCount())) === target.tiles.sharing,
      10_000,
    );
  }
  const snapshot = snapshotSchema.parse(
    await page.evaluate(() => window.__zenRecorderPage?.snapshot()),
  );
  const startedAt = snapshot.recordingStartedAt ?? Date.now();
  await page.evaluate(LAG_PROBE);
  await sleep(WARMUP_S * 1000);
  const s0 = await sample(page, rootPid);
  await sleep(PHASE_S * 1000);
  const s1 = await sample(page, rootPid);
  const cover = await browser.newPage();
  await cover.goto('about:blank');
  await sleep(PHASE_S * 1000);
  const s2 = await sample(page, rootPid);
  await cover.close();
  await page.bringToFront();
  await page.evaluate(() => window.__fixture.hangup());
  await waitFor('recorder stopped', async () => (await overlayState(page)) !== 'recording', 30_000);
  const stoppedAt = Date.now();
  const file = await waitForNewRecording(before);
  const { size } = await stat(file);
  const timeline = await readVideoTimeline(file, size);
  await page.close();
  const wallS = (stoppedAt - startedAt) / 1000;
  const result = {
    provider: target.id,
    profile,
    share: WITH_SHARE,
    file: path.basename(file),
    wallS: round(wallS),
    durationS: round(timeline.durationS),
    framesTotal: timeline.frames.length,
    mbPerMinute: round(size / 1024 / 1024 / (timeline.durationS / 60), 2),
    phases: [
      phaseResult('visible', s0, s1, timeline, startedAt, logs),
      phaseResult('hidden', s1, s2, timeline, startedAt, logs),
    ],
  };
  for (const phase of result.phases) {
    const v = phase.video;
    const split = v
      ? ` | ms/frame find ${v.meanMsPerFrame.find} layout ${v.meanMsPerFrame.layout} draw ${v.meanMsPerFrame.draw} frame ${v.meanMsPerFrame.frame} encode ${v.meanMsPerFrame.encode} wait ${v.meanMsPerFrame.wait} | main ${v.mainThreadMsPerS} ms/s | target ${v.fpsTarget} fps, busy ${v.busyTicksPerS}/s, unchanged ${v.unchangedPerS}/s, p95 total ${v.p95.total} ms`
      : '';
    console.log(
      `  ${phase.phase.padEnd(7)} file ${round(phase.file.fps)} fps (max gap ${round(phase.file.maxGapS, 2)} s) | lag p95 ${phase.lag.p95} max ${phase.lag.max} >50ms ${phase.lag.over50} | cpu ${phase.cpu.cores} cores (tab ${phase.cpu.busiestTab}) | silence ${phase.logs.silence}${split}`,
    );
  }
  console.log(
    `  file ${result.durationS} s for ${result.wallS} s recorded, ${result.framesTotal} frames, ${result.mbPerMinute} MB/min`,
  );
  return result;
}

async function main(): Promise<void> {
  console.log(`audio server: ${selectAudioServer()}`);
  const foreign = foreignFirefoxPids(null);
  if (foreign.length > 0) {
    const message = `${foreign.length} other Firefox process(es) running (${foreign.join(', ')}): timings are not comparable`;
    if (process.env['BENCH_FORCE'] !== '1')
      throw new Error(`${message}; set BENCH_FORCE=1 to run anyway`);
    console.warn(`⚠ ${message}`);
  }
  const { run } = selectTargets();
  const providers = (process.env['BENCH_PROVIDERS'] ?? '').split(',').filter(Boolean);
  const targets = run.filter((t) => providers.length === 0 || providers.includes(t.id));
  const server = await startFixtureServer(PORT);
  const results = [];
  try {
    for (const target of targets) {
      const browser = await launch();
      try {
        await browser.installExtension(EXTENSION_DIR);
        await assertAudioWorks(browser, meetingUrl(target));
        for (const profile of PROFILES) results.push(await benchOne(browser, target, profile));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }
  const outDir = path.join(ROOT, '.e2e/bench');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(outDir, `${LABEL}-${stamp}.json`);
  await writeFile(
    out,
    JSON.stringify(
      { label: LABEL, phaseSeconds: PHASE_S, nominalFps: NOMINAL_FPS, results },
      null,
      2,
    ),
  );
  console.log(`\nresults: ${path.relative(ROOT, out)}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
