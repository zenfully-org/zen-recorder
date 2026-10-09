/**
 * E2e scenario 59, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * tile the page paints over another one (a floating self view) is on top in the recording too.
 *
 * The compositor draws every tile where the page shows it, so where two tiles overlap, the order
 * it draws them in decides which one the recording shows. It drew them sorted by tile id, and a
 * self view floating over the remote participant was drawn under that tile whenever its id sorted
 * first: always on the Meet and Zoom fixtures, at random on Teams, whose tile ids are random. The
 * fixture floats the user's own tile, its camera one solid colour, over the remote tile's corner and
 * later in the document, where the page paints it on top. In the last second of the saved file, the
 * middle of that self view must show its colour.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  probe,
  type Rect,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.literal('tiles') });
const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
const floatedSchema = z.object({ self: rectSchema, remote: rectSchema });

/** The self view's colour: full magenta, which nothing else on the fixtures paints. */
const COLOUR = [255, 0, 255] as const;
/** How far a pixel may be from it, on every channel, to count (lossy coding, the colour tag). */
const RADIUS = 48;
/** The share of the self view's middle that must show its colour. */
const MIN_SHARE = 0.9;

export async function scenarioSelfViewOnTop({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 59: a self view floats over the remote tile → it is on top in the recording too`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  if (!videoModeSchema.safeParse(await probe(page, 'settings:video-on')).success) {
    throw new Error('could not switch video on through the debug probe');
  }
  await page.click('#start');
  await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'two tiles',
    async () => (await page.evaluate(() => window.__fixture.tileCount())) >= 2,
    20_000,
  );
  // The remote participant's video arrives a moment after the call starts.
  await sleep(2_000);
  const colour = `#${COLOUR.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  const floated = floatedSchema
    .nullable()
    .parse(await page.evaluate((c) => window.__fixture.floatSelfView(c), colour));
  if (!floated) throw new Error('the fixture could not float the self view');
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  await page.close();

  const info = await inspectWebm(file);
  console.log(`  ${path.basename(file)} → ${describeWebm(info)}`);
  if (!info.video) throw new Error('the saved file has no video');
  const area = selfViewInFile(floated, info.video);
  const share = colourShare(file, area);
  console.log(
    `    self view at ${area.x},${area.y} ${area.width}x${area.height} in the file: ${(share * 100).toFixed(1)} % of its middle shows its colour`,
  );
  if (share < MIN_SHARE) {
    throw new Error(
      `the self view floating over the remote tile is not on top in the recording: ${(share * 100).toFixed(1)} % of its middle shows its colour, ${MIN_SHARE * 100} % expected`,
    );
  }
}

/**
 * Where the middle half of the self view lies in the file's frames. The compositor mirrors the
 * page: the union of the tiles' rects (here the remote tile's, the self view lies inside it) scaled
 * to fit the frame and centred.
 */
function selfViewInFile(
  floated: { self: Rect; remote: Rect },
  frame: { width: number; height: number },
): Rect {
  const { self, remote } = floated;
  const scale = Math.min(frame.width / remote.width, frame.height / remote.height);
  const left = (frame.width - remote.width * scale) / 2 + (self.x - remote.x) * scale;
  const top = (frame.height - remote.height * scale) / 2 + (self.y - remote.y) * scale;
  const width = self.width * scale;
  const height = self.height * scale;
  return {
    x: Math.round(left + width / 4),
    y: Math.round(top + height / 4),
    width: Math.round(width / 2),
    height: Math.round(height / 2),
  };
}

/** The share of `area`'s pixels, in the file's last second, within `RADIUS` of the colour. */
function colourShare(file: string, area: Rect): number {
  const crop = `crop=${area.width}:${area.height}:${area.x}:${area.y}`;
  const rgb = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-sseof', '-1', '-i', file, '-frames:v', '1'].concat([
      '-vf',
      `${crop},format=rgb24`,
      '-f',
      'rawvideo',
      'pipe:1',
    ]),
    { maxBuffer: 16 * 1024 * 1024 },
  );
  let near = 0;
  for (let at = 0; at + 2 < rgb.length; at += 3) {
    const pixel = [rgb[at] ?? 0, rgb[at + 1] ?? 0, rgb[at + 2] ?? 0];
    if (pixel.every((value, channel) => Math.abs(value - (COLOUR[channel] ?? 0)) <= RADIUS)) near++;
  }
  return near / (area.width * area.height);
}
