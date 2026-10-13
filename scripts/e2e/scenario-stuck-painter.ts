/**
 * E2e scenario 63, run against every provider's fixture page whose tiles a worker paints (Zoom; the
 * others have no such worker and skip it): a busy painting worker does not freeze the meeting page
 * once per recorded frame.
 *
 * Zoom paints its tiles into a canvas its worker owns, and Firefox serves every snapshot of such a
 * canvas by posting to that worker and blocking the page's main thread until the worker answers
 * (`OffscreenCanvasDisplayHelper::GetSurfaceSnapshot`, up to `gfx.offscreencanvas.snapshot-timeout-ms`).
 * Right after joining, Zoom's worker is that busy: the recorder took one snapshot per frame and the
 * page froze for up to a second each time. The fixture keeps its worker busy 1 s in every 1.05 s for
 * 8 s while the page records; meanwhile the page measures how long its main thread could not run
 * (a 50 ms timer that comes late). At most a few long stalls may happen: the one that shows the
 * worker is busy, and the retries.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  describeWebm,
  inspectWebm,
  pageDiagnostics,
  pressCardButton,
  sleep,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { recordPaintedCall } from './record-painted-call';

const lagsSchema = z.array(z.number());

/** The painting worker: busy this long, this often, for this long. */
const BUSY_MS = 1_000;
const EVERY_MS = 1_050;
const FOR_MS = 8_000;
/** A main-thread stall at least this long counts. */
const LONG_STALL_MS = 500;
/** The stalls the recorder may cause meanwhile: the first, and a retry or two. */
const MAX_LONG_STALLS = 3;

export async function scenarioStuckPainter(context: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${context.target.id} scenario 63: the worker that paints the tiles is busy 1 s in every 1.05 s for 8 s → the meeting page does not freeze once per recorded frame`,
  );
  const call = await recordPaintedCall(context);
  if (!call) return;
  const { page, before, opened } = call;
  await page.evaluate(
    (busyMs, everyMs, forMs) => {
      const lags: number[] = [];
      Object.assign(window, { __e2eLags: lags });
      let last = performance.now();
      const meter = window.setInterval(() => {
        const at = performance.now();
        lags.push(at - last - 50);
        last = at;
      }, 50);
      window.setTimeout(() => window.clearInterval(meter), forMs + 500);
      window.__fixture.stallPainter?.(busyMs, everyMs, forMs);
    },
    BUSY_MS,
    EVERY_MS,
    FOR_MS,
  );
  await sleep(FOR_MS + 1_000);
  const lags = lagsSchema.parse(await page.evaluate(() => Reflect.get(window, '__e2eLags') ?? []));
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  const lines = (await pageDiagnostics(page, opened)).filter((line) =>
    /snapshot|video perf/.test(line),
  );
  await page.close();

  const long = lags.filter((lag) => lag >= LONG_STALL_MS);
  const stalled = lags.filter((lag) => lag > 0).reduce((total, lag) => total + lag, 0);
  const info = await inspectWebm(file);
  console.log(`  ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `    page main thread while the worker was busy: ${long.length} stalls of ${LONG_STALL_MS} ms or more (${long.map((lag) => Math.round(lag)).join(', ')} ms), ${Math.round(stalled)} ms stalled in ${FOR_MS} ms`,
  );
  for (const line of lines) console.log(`    ${line}`);
  if (!info.video || info.video.frames < 10) {
    throw new Error(`the recording has ${info.video?.frames ?? 0} video frames`);
  }
  if (long.length > MAX_LONG_STALLS) {
    throw new Error(
      `the meeting page froze ${long.length} times for ${LONG_STALL_MS} ms or more while the painting worker was busy (${Math.round(stalled)} ms in ${FOR_MS} ms), ${MAX_LONG_STALLS} at most expected`,
    );
  }
}

export const registration = {
  name: '63',
  after: '64',
  scenario: scenarioStuckPainter,
} satisfies ScenarioRegistration;
