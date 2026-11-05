/**
 * E2e scenario 103, run against every provider's fixture page: a recording with video whose file
 * ends up with one track says so in its notes, the track it has and not the two it started with.
 *
 * The page's encoder muxes the video and the audio into one file and writes its tracks once each
 * has a sample; at the Stop it writes the tracks that have one. So a Stop after the first frame
 * and before the first audio sample leaves a file of video alone, and one after the first audio
 * sample and before the first frame a file of audio alone. The notes took what the file holds
 * from what the recording started with and said "video and audio" for both. A Stop at once only
 * sometimes lands between the two, so each part holds one of them back for the whole recording:
 *
 *   - The audio never starts: before the call, `window.AudioContext` is a subclass that suspends
 *     itself and ignores `resume()`, as a browser that can open no audio output keeps every
 *     context suspended. The recorder makes its context from the page's constructor when a
 *     recording starts, so its audio tap gets no buffer while the video records. The file must
 *     hold one video track, and its notes must say `media: "video"` (the data block and the front
 *     matter) and "video only, no audio".
 *   - The video never encodes: once the page's video probe has answered (it encodes a frame of
 *     its own, and keeps its answer), `window.VideoEncoder` is a subclass that drops every frame.
 *     The file must hold one audio track, and its notes must say `media: "audio"` and "audio
 *     only".
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  probe,
  recordingStarted,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import { waitForNotes } from './notes-files';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

/** How long each part records before its Stop. */
const RECORD_MS = 5_000;

interface Part {
  label: string;
  /** Holds one track back on the page, before the call starts. */
  holdBack: (page: Page, since: number) => Promise<void>;
  /** What the file must hold, as `inspectWebm` counts it, and what its notes must say. */
  video: boolean;
  media: 'video' | 'audio';
  words: string;
}

/** The recorder's audio context, as a browser that can open no audio output leaves it. */
async function holdAudioBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.AudioContext = class extends window.AudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        void this.suspend();
      }
      override resume(): Promise<void> {
        return Promise.resolve();
      }
    };
  });
}

/** The page's video encoder, once the probe that encodes a frame of its own has answered. */
async function holdVideoBack(page: Page, since: number): Promise<void> {
  await waitFor(
    'the video probe',
    async () =>
      (await pageDiagnostics(page, since)).some((line) => /video probe: vp[89] /.test(line)),
    20_000,
  );
  await page.evaluate(() => {
    window.VideoEncoder = class extends window.VideoEncoder {
      override encode(): void {
        // Drops the frame: the encoder never outputs a packet.
      }
    };
  });
}

const PARTS: readonly Part[] = [
  {
    label: 'the audio never starts',
    holdBack: holdAudioBack,
    video: true,
    media: 'video',
    words: 'video only, no audio',
  },
  {
    label: 'the video never encodes',
    holdBack: holdVideoBack,
    video: false,
    media: 'audio',
    words: 'audio only',
  },
];

/** What is wrong with a part's file and its notes; nothing when both say the same. */
async function recordPart(browser: ScenarioContext['browser'], target: FixtureTarget, part: Part) {
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
    if (!result.success || result.data.videoMode !== 'tiles') {
      throw new Error('could not switch video on through the debug probe');
    }
    await part.holdBack(page, since);
    const before = new Set(await listWebm());
    await page.click('#start');
    await waitFor(`${part.label}: the recording`, () => recordingStarted(page), 20_000);
    await sleep(RECORD_MS);
    await pressCardButton(page, 'Stop');
    const file = await waitForNewRecording(before);
    const info = await inspectWebm(file);
    console.log(`  ${part.label}: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
    const { text, document } = await waitForNotes(file);
    const summary = text.split('\n').find((line) => line.startsWith('- **Recording:**')) ?? '';
    console.log(`    notes: media ${document.recording.media}; ${summary}`);
    return [
      ...(info.tracks === 1 && (info.video !== null) === part.video
        ? []
        : [`the file holds ${describeWebm(info)}, not ${part.media} alone`]),
      ...(document.recording.media === part.media
        ? []
        : [`the notes say media "${document.recording.media}", not "${part.media}"`]),
      ...(text.includes(`\nmedia: "${part.media}"\n`)
        ? []
        : [`the front matter does not say media "${part.media}"`]),
      ...(summary.endsWith(`, ${part.words}`) ? [] : [`the summary does not say "${part.words}"`]),
    ].map((problem) => `${part.label}: ${problem}`);
  } finally {
    await page.close();
  }
}

export async function scenarioOneTrackFile({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 103: a video recording whose file holds one track → its notes say that track`,
  );
  const problems: string[] = [];
  for (const part of PARTS) problems.push(...(await recordPart(browser, target, part)));
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '103',
  // Next to scenario 12: both are about what a Stop before a track's first sample saves.
  after: '12',
  scenario: scenarioOneTrackFile,
} satisfies ScenarioRegistration;
