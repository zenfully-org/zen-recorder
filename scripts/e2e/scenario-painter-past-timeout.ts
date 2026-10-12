/**
 * E2e scenario 95, run against every provider's fixture page whose tiles a worker paints (Zoom; the
 * others have no such worker and skip it): a painting worker stuck for longer than Firefox's
 * snapshot timeout freezes the meeting page once, not again at the next frame, and the recorder
 * counts that freeze apart from what drawing costs.
 *
 * Firefox serves a snapshot of a canvas a worker owns by blocking the page's main thread until the
 * worker answers, and gives up after `gfx.offscreencanvas.snapshot-timeout-ms` (10 s). The same
 * timeout ends a deadlock seen on the fixture page: a worker that paints with a 2D context can need
 * the main thread while it takes the snapshot (`ImageBridgeChild::SyncWithCompositor`), and the main
 * thread is waiting for it. The recorder cannot shorten that first freeze. It holds the canvas back
 * afterwards: its tiles are drawn as placeholders for 5 s from the moment the page runs again. A
 * hold counted from the moment the snapshot was asked for was over when it returned, so a stuck
 * worker froze the page again at the next frame. The freeze also counted as drawing time, and one
 * freeze lowered the frame rate to 5 fps for over a minute.
 *
 * The fixture keeps its painting worker busy for 12 s in one go while the page records; a 50 ms
 * timer in the page notes when its main thread could not run.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  inspectWebm,
  pageDiagnostics,
  pressCardButton,
  sleep,
  waitForNewRecording,
} from './harness';
import type { ScenarioRegistration } from './order-scenarios';
import { recordPaintedCall } from './record-painted-call';
import type { ScenarioContext } from './scenarios';

const stallsSchema = z.array(z.object({ at: z.number(), ms: z.number() }));
const sumsSchema = z.object({
  video: z.object({ sums: z.object({ draw: z.number(), frozen: z.number().default(0) }) }),
});

/** The painting worker is busy this long in one go: past Firefox's snapshot timeout. */
const STUCK_MS = 12_000;
/** Firefox's `gfx.offscreencanvas.snapshot-timeout-ms`, less some slack for timers. */
const TIMEOUT_MS = 9_000;
/** How long the canvas is held back after its first freeze, less some slack for timers. */
const HOLD_MS = 4_500;
/** A main-thread stall at least this long counts. */
const LONG_STALL_MS = 500;

const readSums = async (page: Page) =>
  sumsSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.debug())).video.sums;

export async function scenarioPainterPastTimeout(context: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${context.target.id} scenario 95: the worker that paints the tiles is stuck for 12 s → the meeting page freezes once (Firefox's snapshot timeout), not again at the next frame, and the freeze is not counted as drawing`,
  );
  const call = await recordPaintedCall(context);
  if (!call) return;
  const { page, before, opened } = call;
  const sumsBefore = await readSums(page);
  await page.evaluate((stuckMs) => {
    const stalls: { at: number; ms: number }[] = [];
    Object.assign(window, { __e2eStalls: stalls });
    let last = performance.now();
    const meter = window.setInterval(() => {
      const now = performance.now();
      const ms = now - last - 50;
      if (ms >= 100) stalls.push({ at: now - ms, ms });
      last = now;
    }, 50);
    window.setTimeout(() => window.clearInterval(meter), stuckMs + 8_000);
    window.__fixture.stallPainter?.(stuckMs, 10, stuckMs);
  }, STUCK_MS);
  // Read right after the first freeze: the draw time of the few seconds around it is small.
  await sleep(11_500);
  const sumsAfter = await readSums(page);
  await sleep(STUCK_MS - 11_500 + 8_500);
  const stalls = stallsSchema.parse(
    await page.evaluate(() => Reflect.get(window, '__e2eStalls') ?? []),
  );
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  const lines = (await pageDiagnostics(page, opened)).filter((line) =>
    /snapshot|video perf|video rate/.test(line),
  );
  await page.close();

  const info = await inspectWebm(file);
  const long = stalls.filter((stall) => stall.ms >= LONG_STALL_MS);
  const frozen = sumsAfter.frozen - sumsBefore.frozen;
  const drawn = sumsAfter.draw - sumsBefore.draw;
  console.log(`  ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `    page main thread: stalls of ${LONG_STALL_MS} ms or more at ${long.map((stall) => `+${Math.round(stall.at - (long[0]?.at ?? 0))} ms for ${Math.round(stall.ms)} ms`).join(', ')}; the recorder counted ${Math.round(frozen)} ms frozen and ${Math.round(drawn)} ms drawing around the first freeze`,
  );
  for (const line of lines) console.log(`    ${line}`);
  const first = long[0];
  if (!first || first.ms < TIMEOUT_MS) {
    throw new Error(
      `the stuck painting worker froze the page for ${Math.round(first?.ms ?? 0)} ms at most, not for Firefox's snapshot timeout: the scenario no longer shows what it guards (does Firefox still block the page on a worker's canvas?)`,
    );
  }
  const again = long.filter((stall) => stall !== first && stall.at < first.at + first.ms + HOLD_MS);
  if (again.length > 0) {
    const after = again.map((stall) => Math.round(stall.at - first.at - first.ms)).join(', ');
    throw new Error(
      `the page froze again ${after} ms after the first freeze ended, while the canvas should be held back for 5 s`,
    );
  }
  if (frozen < TIMEOUT_MS || drawn >= TIMEOUT_MS / 2) {
    throw new Error(
      `the recorder counted the freeze as drawing: ${Math.round(drawn)} ms drawing and ${Math.round(frozen)} ms frozen around a ${Math.round(first.ms)} ms freeze`,
    );
  }
  if (!info.video || info.video.frames < 10) {
    throw new Error(`the recording has ${info.video?.frames ?? 0} video frames`);
  }
}

export const registration = {
  name: '95',
  after: '63',
  scenario: scenarioPainterPastTimeout,
} satisfies ScenarioRegistration;
