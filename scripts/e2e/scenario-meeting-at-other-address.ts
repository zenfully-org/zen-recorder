/**
 * E2e scenario 100, run against every provider's fixture page that has another address for its
 * meetings (`FixtureTarget.otherAddress`, Meet's `/meet/<code>`): a meeting opened there is
 * recorded like any other.
 *
 * Meet opens some meetings at `meet.google.com/meet/<code>`, and titles their tab
 * `Meet: <meeting>` there, where it used to open them at `/<code>` as `<meeting> - Google Meet`.
 * A recorder that looked for the code only at the start of the path saw no meeting there and
 * recorded nothing, not even on a click.
 *
 *   - The page joins with nobody else in the call: the status card waits, and the recorder reads
 *     the meeting's id and its title without the service's prefix.
 *   - Someone joins: the recording starts on its own.
 *   - The hang-up saves one file named after the meeting, and its notes name the meeting's id,
 *     its title and its link.
 *
 * Other providers skip it.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { getProviderDescriptor } from '@/lib/providers/get-provider-descriptor';
import {
  currentRecordingId,
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import { waitForNotes } from './notes-files';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';

/** What the recorder reads of the meeting, from its snapshot. */
const meetingSchema = z.object({ meetingCode: z.string().nullable(), title: z.string() });

/** The page is read once a second; a join must start the recording within a few. */
const START_WITHIN_MS = 5_000;

async function readMeeting(page: Page): Promise<z.infer<typeof meetingSchema> | null> {
  const parsed = meetingSchema.safeParse(
    await page.evaluate(() => window.__zenRecorderPage?.snapshot() ?? null),
  );
  return parsed.success ? parsed.data : null;
}

/** What the status card and the recorder say, for a wait that timed out. */
async function describeRecorder(page: Page): Promise<string> {
  const meeting = await readMeeting(page);
  const seen = meeting
    ? `meeting id ${JSON.stringify(meeting.meetingCode)}, title ${JSON.stringify(meeting.title)}`
    : 'no snapshot';
  return `the status card says ${(await overlayState(page)) ?? 'nothing'}; the recorder reads ${seen}`;
}

/** The file's name less its `(n)` and extension ends with the meeting's title. */
function expectNamedAfter(file: string, title: string): void {
  const stem = path.basename(file).replace(/(?:\(\d+\))?\.webm$/, '');
  if (!stem.endsWith(`_${title}`)) {
    throw new Error(`expected the file to be named after "${title}", got ${path.basename(file)}`);
  }
}

export async function scenarioMeetingAtOtherAddress({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  const { otherAddress } = target;
  if (!otherAddress) {
    console.log(`▶ ${target.id} scenario 100: skipped (the service has one address per meeting)`);
    return;
  }
  const { meetingId, title } = otherAddress;
  console.log(
    `▶ ${target.id} scenario 100: a meeting opened at ${otherAddress.path} records on its own`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target, otherAddress.path));
  try {
    await page.evaluate(() => window.__fixture.emptySlots?.());
    await page.click('#start');
    await waitFor(
      'the status card waiting in the call, alone',
      async () => (await overlayState(page)) === 'waiting',
      20_000,
      () => describeRecorder(page),
    );
    const alone = await readMeeting(page);
    expectEqual(alone?.meetingCode, meetingId, 'meeting id the recorder reads');
    expectEqual(alone?.title, title, 'meeting title the recorder reads');
    console.log(`  waiting alone, the meeting read as ${meetingId} "${title}"`);
    const joinedAt = Date.now();
    await page.evaluate(() => window.__fixture.addParticipant({ name: 'Ana', camera: false }));
    await waitFor(
      'recording once someone joined',
      async () => (await overlayState(page)) === 'recording',
      START_WITHIN_MS,
      () => describeRecorder(page),
    );
    console.log(
      `  recording ${((Date.now() - joinedAt) / 1000).toFixed(1)} s after someone joined`,
    );
    const id = await waitFor('a recording id', () => currentRecordingId(page), 10_000);
    await waitForEveryTrack(page, id);
    await sleep(2_000);
    await page.evaluate(() => window.__fixture.hangup());
    const file = await waitForNewRecording(before);
    console.log(`  file: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
    expectNamedAfter(file, title);
    const { meeting } = (await waitForNotes(file)).document;
    console.log(`  notes: ${meeting.service} ${meeting.id} "${meeting.title}" ${meeting.url}`);
    expectEqual(meeting.id, meetingId, 'meeting id in the notes');
    expectEqual(meeting.title, title, 'meeting title in the notes');
    expectEqual(
      meeting.url,
      getProviderDescriptor(target.id).meetingUrl(meetingId),
      'meeting link in the notes',
    );
  } finally {
    await page.close();
  }
}

export const registration = {
  name: '100',
  // Next to scenario 73: both start a recording once someone joins a call the user was alone in.
  after: '73',
  scenario: scenarioMeetingAtOtherAddress,
} satisfies ScenarioRegistration;
