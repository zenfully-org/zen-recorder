/**
 * E2e scenario 50, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * saved video, decoded the way its colour tag says, shows the colours the meeting showed, for a
 * recording stopped with Stop and for one saved as "(recovered)" after its tab died.
 *
 * Firefox's video encoder converts the composited canvas to YUV with BT.601 at limited range (up
 * to at least Firefox 160) while its own report says BT.709 (Bugzilla 2057760), so the recorder
 * tags the video with the conversion, a constant. This scenario is the tripwire for a Firefox that
 * converts otherwise: CI runs it on the latest release. The fixture paints its own tiles with
 * full-strength colour bars, ffmpeg decodes a frame from the middle of each file with the matrix
 * and range the file names, and every saturated bar must come out within a few levels of what was
 * painted. When they do not, the frame is decoded again with each matrix and range forced, and the
 * failure names the one that brings the bars back: the conversion the tag has to name.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { dieLikeACrash } from './die-like-a-crash';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import { judgeColourBars, type RgbFrame } from './judge-colour-bars';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.literal('tiles') });
const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), chunkCount: z.number() })),
});
const colourTagsSchema = z.object({
  streams: z.array(
    z.object({
      width: z.number(),
      height: z.number(),
      color_space: z.string().default('unknown'),
      color_range: z.string().default('unknown'),
      color_primaries: z.string().default('unknown'),
      color_transfer: z.string().default('unknown'),
    }),
  ),
});
type ColourTags = z.infer<typeof colourTagsSchema>['streams'][number];

/** A YUV to RGB conversion, as ffmpeg's scale filter names its matrix and range. */
interface Conversion {
  matrix: string;
  range: string;
}

/** The file's own tags: ffmpeg reads the matrix and the range from each decoded frame. */
const AS_TAGGED: Conversion = { matrix: 'auto', range: 'auto' };
/** The conversions an encoder of SDR video uses, tried when the tagged one does not fit. */
const CONVERSIONS: Conversion[] = [
  { matrix: 'bt601', range: 'tv' },
  { matrix: 'bt709', range: 'tv' },
  { matrix: 'bt601', range: 'pc' },
  { matrix: 'bt709', range: 'pc' },
];
/** Where the recorder names the conversion. */
const TAG_CONSTANT = 'FIREFOX_CANVAS_COLOUR in src/lib/page/create-webcodecs-encoder.ts';

export async function scenarioColoursMatchTag({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 50: colour bars in the meeting → a stopped and a recovered file, decoded as their colour tag says, show the same colours`,
  );
  const firefox = await browser.version();
  const problems: string[] = [];

  let before = new Set(await listWebm());
  const stopped = await openMeetingWithBars(browser, target);
  await stopped.page.click('#start');
  await waitFor('recording', () => currentRecordingId(stopped.page), 20_000);
  await sleep(4_000);
  await stopped.page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const stoppedFile = await waitForNewRecording(before);
  problems.push(...(await judge('stopped', stoppedFile, stopped.bars, firefox)));
  await stopped.page.close();

  before = new Set(await listWebm());
  const crashed = await openMeetingWithBars(browser, target);
  await crashed.page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(crashed.page), 20_000);
  // Two stored chunks at least, so that the recovered file holds more than the first one.
  await waitFor(
    'two chunks stored',
    async () =>
      (recordingsSchema
        .parse(await probe(crashed.page, 'background:state'))
        .recordings.find((recording) => recording.id === id)?.chunkCount ?? 0) > 1,
    20_000,
  );
  await dieLikeACrash(crashed.page);
  await crashed.page.close();
  const recovered = await waitForNewRecording(before, (file) => file.includes('(recovered)'));
  problems.push(...(await judge('recovered', recovered, crashed.bars, firefox)));

  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** A meeting page that records video, its own tiles painted with colour bars. */
async function openMeetingWithBars(
  browser: ScenarioContext['browser'],
  target: ScenarioContext['target'],
): Promise<{ page: Page; bars: string[] }> {
  const page = await openMeeting(browser, meetingUrl(target));
  if (!videoModeSchema.safeParse(await probe(page, 'settings:video-on')).success) {
    throw new Error('could not switch video on through the debug probe');
  }
  const bars = z
    .array(z.string())
    .parse(await page.evaluate(() => window.__fixture.showColourBars()));
  return { page, bars };
}

/** The colour tags of the file's video stream, as ffprobe reads them, and the stream's size. */
function readColourTags(file: string): ColourTags {
  const json = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,color_space,color_range,color_primaries,color_transfer',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  const [stream] = colourTagsSchema.parse(JSON.parse(json)).streams;
  if (!stream) throw new Error(`no video stream in ${file}`);
  return stream;
}

/** The frame at `atS` seconds as RGB, converted from YUV with `conversion`. */
function decodeFrame(
  file: string,
  atS: number,
  tags: ColourTags,
  conversion: Conversion,
): RgbFrame {
  const rgb = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      atS.toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `scale=in_color_matrix=${conversion.matrix}:in_range=${conversion.range},format=rgb24`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (rgb.length !== tags.width * tags.height * 3) {
    throw new Error(
      `ffmpeg decoded ${rgb.length} bytes, expected a ${tags.width}x${tags.height} frame`,
    );
  }
  return { width: tags.width, height: tags.height, rgb: new Uint8Array(rgb) };
}

/**
 * What is wrong with the colours of `file`: nothing when every saturated bar shows as painted,
 * else one line that says by how much, and which conversion the tag would have to name.
 */
async function judge(
  label: string,
  file: string,
  bars: readonly string[],
  firefox: string,
): Promise<string[]> {
  const info = await inspectWebm(file);
  const tags = readColourTags(file);
  console.log(`  ${label}: ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `    colour tags: matrix ${tags.color_space}, range ${tags.color_range}, primaries ${tags.color_primaries}, transfer ${tags.color_transfer}`,
  );
  const atS = info.durationS / 2;
  const verdict = judgeColourBars(decodeFrame(file, atS, tags, AS_TAGGED), bars);
  const readings = verdict.readings.map(
    (reading) =>
      `${reading.bar} → ${reading.shown ? `(${reading.shown.join(', ')}) ${reading.off} off` : 'not found'}`,
  );
  console.log(`    bars at ${atS.toFixed(1)} s, decoded as tagged: ${readings.join(' · ')}`);
  if (verdict.problems.length === 0) return [];
  const fits = CONVERSIONS.filter(
    (conversion) =>
      judgeColourBars(decodeFrame(file, atS, tags, conversion), bars).problems.length === 0,
  ).map((conversion) => `${conversion.matrix}/${conversion.range}`);
  const worst = Math.max(...verdict.readings.map((reading) => reading.off ?? 0));
  const tagged = `${tags.color_space}/${tags.color_range}`;
  const cause =
    fits.length > 0
      ? `they come out right as ${fits.join(' or ')}: ${firefox} converts the canvas that way, so ${TAG_CONSTANT} must name it from the Firefox version that changed the conversion on`
      : `no matrix and range bring them back (${verdict.problems.join(', ')})`;
  return [
    `${label}: decoded as tagged (${tagged}), ${verdict.problems.length} colour bars are off by up to ${worst} levels; ${cause}`,
  ];
}
