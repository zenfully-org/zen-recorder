/**
 * E2e scenario 90, run against every provider's fixture page like the ones in `scenarios.ts`: every
 * saved recording gets its meeting notes, a Markdown file next to it under its saved name.
 *
 *   - Two recordings in one call, named after the meeting's title alone
 *     (`settings:template-title`): Firefox names the second file `X(n).webm`, and its notes are
 *     `X(n).md`. Each notes file parses with the format's own parser, names its service and its
 *     file, says its events are complete, gives a length within 1 s of the file's, and holds the
 *     recording's start (seq 0) and stop (seq 1), each placed within the file.
 *   - With the notes off (`settings:notes-off`), a saved recording gets no notes file, and its
 *     notes state says they were skipped.
 *   - A tab that dies like a crash: its "(recovered)" recording gets "(recovered).md", which says
 *     it was recovered, that its end is estimated, and that its events are incomplete.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { z } from 'zod';
import { dieLikeACrash } from './die-like-a-crash';
import {
  currentRecordingId,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  probe,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import { notesFor, waitForNotes } from './notes-files';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** How far the notes' length may be from the file's. */
const TOLERANCE_MS = 1_000;

const newestSchema = z.object({
  recording: z.object({ id: z.string(), notesState: z.string().nullable() }),
});

/** Starts a recording with `start`, waits for its first stored chunk, records 2 s and stops it. */
async function recordAndStop(page: Page, start: () => Promise<unknown>): Promise<string> {
  await start();
  await waitFor('recording', async () => (await overlayState(page)) === 'recording', 20_000);
  const id = await waitFor('a recording id', () => currentRecordingId(page), 20_000);
  // A Stop before the first sample saves nothing, by design.
  await waitFor(
    'its first chunk stored',
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 0,
    20_000,
  );
  await sleep(2_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  return id;
}

/** Checks the notes next to saved recording `webm` against the file itself. */
async function checkNotes(target: FixtureTarget, webm: string): Promise<void> {
  const { document } = await waitForNotes(webm);
  const fileMs = (await inspectWebm(webm)).durationS * 1000;
  const { meeting, recording, capture, events } = document;
  const timeline = events.map((event) => `${event.seq} ${event.type} @${event.mediaMs}`);
  console.log(
    `  ${path.basename(notesFor(webm))}: ${meeting.service} ${meeting.id} "${meeting.title}", ${recording.durationMs} ms (file ${fileMs.toFixed(0)} ms), events ${capture.events}: ${timeline.join(', ')}`,
  );
  const durationMs = recording.durationMs ?? Number.NaN;
  const sequence = events.map((event) => `${event.seq} ${event.type}`).join(', ');
  const problems = [
    ...(meeting.service === target.id ? [] : [`the service is ${meeting.service}`]),
    ...(recording.file === path.basename(webm) ? [] : [`the notes name ${recording.file}`]),
    ...(capture.events === 'complete' ? [] : [`the events are ${capture.events}`]),
    ...(Math.abs(durationMs - fileMs) <= TOLERANCE_MS ? [] : ["the length is not the file's"]),
    ...(sequence === '0 recording-started, 1 recording-stopped'
      ? []
      : [`the events are ${sequence}`]),
    ...(events.every((event) => event.mediaMs >= 0 && event.mediaMs <= durationMs)
      ? []
      : ['an event is placed outside the file']),
  ];
  if (problems.length > 0) throw new Error(`${path.basename(webm)}: ${problems.join('; ')}`);
}

/** Two recordings of one call under one name: the second file, and its notes, get `(n)`. */
async function twoRecordings(browser: Browser, target: FixtureTarget): Promise<void> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    await recordAndStop(page, () => page.click('#start'));
    const first = await waitForNewRecording(before);
    await recordAndStop(page, () => page.evaluate(() => window.__fixture.clickOverlay('Record')));
    const second = await waitForNewRecording(new Set([...before, first]));
    if (!/\(\d+\)\.webm$/.test(second)) throw new Error(`not uniquified: ${second}`);
    await checkNotes(target, first);
    await checkNotes(target, second);
  } finally {
    await page.close();
  }
}

/** With the notes off: the recording is saved, and nothing is written beside it. */
async function notesOff(browser: Browser, target: FixtureTarget, control: Page): Promise<void> {
  await probe(control, 'settings:notes-off');
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    const id = await recordAndStop(page, () => page.click('#start'));
    const webm = await waitForNewRecording(before);
    await waitFor(
      'its notes skipped',
      async () => {
        const newest = newestSchema.safeParse(await probe(control, 'notes:events'));
        return newest.success && newest.data.recording.id === id
          ? newest.data.recording.notesState === 'skipped'
          : false;
      },
      20_000,
    );
    if (existsSync(notesFor(webm))) throw new Error('a notes file was written with the notes off');
    console.log(`  notes off: ${path.basename(webm)} saved, no notes file, notes skipped`);
  } finally {
    await probe(control, 'settings:notes-on');
    await page.close();
  }
}

/** A crashed tab: the recovered recording's notes say what is not known. */
async function recovered(browser: Browser, target: FixtureTarget): Promise<void> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.bringToFront();
  await page.click('#start');
  const id = await waitFor('a recording id', () => currentRecordingId(page), 20_000);
  await waitFor(
    'two chunks stored',
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 1,
    20_000,
  );
  await dieLikeACrash(page);
  await page.close();
  const webm = await waitForNewRecording(before, (file) => file.includes('(recovered)'));
  const { document } = await waitForNotes(webm);
  const { recording, capture } = document;
  console.log(
    `  ${path.basename(notesFor(webm))}: recovered ${recording.recovered}, end estimated ${recording.endEstimated}, events ${capture.events} (${capture.eventsMissingReason})`,
  );
  if (!(recording.recovered && recording.endEstimated && capture.events === 'incomplete')) {
    throw new Error(`${path.basename(webm)}: the notes do not say it was recovered`);
  }
}

export async function scenarioMeetingNotes({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 90: a notes file next to every saved recording`);
  // Not in the call: it switches the settings through runtime messages.
  const control = await openMeeting(browser, meetingUrl(target));
  await probe(control, 'settings:template-title');
  try {
    await twoRecordings(browser, target);
    await notesOff(browser, target, control);
    await recovered(browser, target);
  } finally {
    await probe(control, 'settings:template-default');
    await control.close();
  }
}
