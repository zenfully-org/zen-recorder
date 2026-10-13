/**
 * E2e scenario 1, run against every provider's fixture page: auto-record with video while the tab
 * is covered, a screen share, mute, stop on hangup. In front, hidden and sharing, the file holds
 * the frames the recorder aimed for, unless it measured itself overloaded (a busy machine lowers
 * the rate, a stalled tab does not).
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { readVideoTimeline } from '../bench/read-video-timeline';
import { checkShareInNotes } from './check-share-in-notes';
import {
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  overlayState,
  recordingStarted,
  recordingStartedAt,
  sampleVideoStats,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import { judgeFrameSpan, type VideoStatsSample } from './judge-frame-span';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

async function sleepAndSample(page: Page, ms: number): Promise<VideoStatsSample> {
  await sleep(ms);
  return sampleVideoStats(page);
}

export async function scenarioAutoRecordAndHangup({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 1: auto-record (audio + video tiles), hidden tab, share, stop on hangup`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start'); // a real click: gives the page user activation like "Join now" does
  await waitFor('recording state', async () => (await overlayState(page)) === 'recording', 20_000);
  console.log('  recording started');
  await waitFor(
    `${target.tiles.call} tiles`,
    async () => (await page.evaluate(() => window.__fixture.tileCount())) === target.tiles.call,
    10_000,
  );
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  // The recorder's statistics at the ends of each phase: its frames are judged phase by phase.
  const inFront = { from: await sampleVideoStats(page), to: await sleepAndSample(page, 4_000) };
  // Cover the meeting tab for a while: the compositor must keep producing frames while hidden.
  const cover = await browser.newPage();
  await cover.goto('about:blank');
  const hidden = { from: await sampleVideoStats(page), to: await sleepAndSample(page, 6_000) };
  await cover.close();
  await page.bringToFront();
  const backInFront = await sampleVideoStats(page);
  await page.evaluate(() => window.__fixture.toggleShare());
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.mute());
  await sleep(2_000);
  await page.evaluate(() => window.__fixture.unmute());
  const sharing = { from: backInFront, to: await sleepAndSample(page, 2_000) };
  const overlay = await page.evaluate(() => window.__fixture.overlayState()?.text ?? '');
  if (!overlay.includes(`${target.tiles.sharing} tiles`)) {
    throw new Error(`overlay should show ${target.tiles.sharing} video tiles, got "${overlay}"`);
  }
  await page.evaluate(() => window.__fixture.hangup());
  await waitFor(
    'recorder stopped',
    async () => ['idle', 'waiting'].includes((await overlayState(page)) ?? ''),
    30_000,
  );
  const file = await waitForNewRecording(before);
  await checkShareInNotes(file, target);
  await sleep(2_000);
  for (const saved of await newRecordings(before)) {
    console.log(`  file: ${path.basename(saved)} → ${describeWebm(await inspectWebm(saved))}`);
    console.log(`    ffprobe: ${ffprobe(saved)}`);
  }
  const info = await inspectWebm(file);
  if (info.bytes < 100_000) throw new Error('file suspiciously small');
  if (!(info.durationS > 15 && info.durationS < 60)) {
    throw new Error(`unexpected duration ${info.durationS}`);
  }
  if (info.tracks !== 2) throw new Error(`expected audio + video tracks, got ${info.tracks}`);
  const video = info.video;
  if (!video) throw new Error('expected a video track');
  if (video.codec !== 'vp9') throw new Error(`expected VP9, got ${video.codec}`);
  if (video.width !== 1920 || video.height !== 1080) {
    throw new Error(`expected 1920x1080, got ${video.width}x${video.height}`);
  }
  // The fixture tiles change every frame, so every phase, hidden too, must hold frames at the rate
  // the recorder aimed for, unless the machine was too busy for it (see `judgeFrameSpan`).
  const frameTimes = (await readVideoTimeline(file, info.bytes)).frames.map((frame) => frame.t);
  const phases = { 'in front': inFront, hidden, 'in front, sharing': sharing };
  const verdicts = Object.entries(phases).map(([label, span]) =>
    judgeFrameSpan({ label, ...span, startedAt, frameTimes }),
  );
  for (const { summary } of verdicts) console.log(`  frames: ${summary}`);
  const stalled = verdicts.filter((span) => span.verdict === 'stalled');
  if (stalled.length > 0) {
    const spans = stalled.map((span) => span.summary).join('; ');
    throw new Error(`too few video frames, with no load to explain it (tab stalled?): ${spans}`);
  }
  await page.close();
}

export const registration = {
  name: '1',
  after: '87',
  scenario: scenarioAutoRecordAndHangup,
} satisfies ScenarioRegistration;
