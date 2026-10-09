/**
 * E2e scenario 77, run against every provider's fixture page like the ones in `scenarios.ts`: on
 * Meet, a recording made alone in a call with the camera off shows the user's tile as initials,
 * not an empty frame.
 *
 * A tile whose camera is off shows an avatar and no video. The recorder skipped tiles without a
 * video, so alone with the camera off it drew no tile at all, and the whole video said "No video
 * tiles".
 *
 *   - The page joins with nobody else in the call (`FixtureApi.emptySlots`) and the camera off
 *     (`cameraOff`): the user's tile has an avatar and no `<video>`.
 *   - Record is pressed on the status card. The recorder must draw one tile.
 *   - A frame of the saved file must be the placeholder's grey across the picture, not the empty
 *     frame's dark background.
 *
 * Fixtures without `cameraOff` (Zoom, Teams, whose readers already draw such tiles) skip it.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  recordingStarted,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/**
 * Mean luma (0-255) of the frame at `atS`. The empty frame is the background `#202124` with a line
 * of text (about 45); the placeholder fills the tile with `#3c4043` (about 70).
 */
function meanLuma(file: string, atS: number): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-nostats', '-v', 'info', '-i', file],
      ...['-vf', `select=gte(t\\,${atS}),signalstats,metadata=print:key=lavfi.signalstats.YAVG`],
      ...['-frames:v', '1', '-f', 'null', '-'],
    ],
    { encoding: 'utf8' },
  );
  const luma = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stderr)?.[1];
  if (luma === undefined) throw new Error(`no frame at ${atS} s in ${file}: ${stderr.slice(-400)}`);
  return Number(luma);
}

/** Between the empty frame's luma and the placeholder's. */
const PLACEHOLDER_LUMA = 57;

export async function scenarioCameraOffAlone({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 77: alone with the camera off, the recording shows initials`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  if (!(await page.evaluate(() => typeof window.__fixture.cameraOff === 'function'))) {
    console.log(`  skipped: the ${target.label} fixture has no camera to turn off`);
    await page.close();
    return;
  }
  const before = new Set(await listWebm());
  await page.evaluate(() => {
    window.__fixture.emptySlots?.();
    window.__fixture.cameraOff?.();
  });
  await page.click('#start');
  await waitFor('alone in the call', async () => (await overlayState(page)) === 'waiting', 20_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Record'));
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  await sleep(4_000);
  const tiles = await page.evaluate(() => window.__zenRecorderPage?.snapshot().videoTiles ?? 0);
  console.log(`  tiles the recorder draws: ${tiles}`);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
  const luma = meanLuma(file, 2);
  console.log(
    `  mean luma at 2 s: ${luma.toFixed(1)} (empty frame about 45, placeholder about 70)`,
  );
  if (tiles !== 1 || !(luma > PLACEHOLDER_LUMA)) {
    throw new Error(
      `alone with the camera off the recorder drew ${tiles} tile(s) and the frame's mean luma is ${luma.toFixed(1)}: expected the user's tile as initials (1 tile, luma above ${PLACEHOLDER_LUMA}), not "No video tiles"`,
    );
  }
  await page.evaluate(() => window.__fixture.hangup());
  await page.close();
}
