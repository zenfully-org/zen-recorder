/**
 * E2e scenario 99, run against every provider's fixture page right after scenario 96: the meeting
 * notes say who was in the call, and who joined and left, each where it happened in the file.
 *
 * In a call that records by itself, someone joins under an invented name with a character the
 * notes must escape, stays 3 s and leaves; 3 s later the run pauses for 4 s, resumes and stops.
 * The notes must list the user as themselves (also where the page cannot tell which tile is the
 * user's) and the person in the call from the start as there at both ends; the newcomer joined
 * and left where the page made them happen (its own clock: a page can freeze), within 1.5 s, in
 * the data, in the participants table and in the timeline, which tells the leave before the pause
 * although a leave is written only once it held 10 s. Every position lies within the saved
 * file. Each fake page counts the people in the call and shows all of them, so every service names
 * who came and went.
 *
 * Every check is made before the scenario fails, so one run of an older build shows everything it
 * gets wrong, and the notes' people and timeline are printed.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';
import {
  currentRecordingId,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pressCardButton,
  recordingStartedAt,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import { waitForNotes } from './notes-files';
import type { ScenarioRegistration } from './order-scenarios';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** Someone who joins the call, named the way people name themselves at work. */
const NEWCOMER = 'Chloé Martin | Design';
const STAY_MS = 3_000;
const PAUSE_MS = 4_000;
/** How far a position may be from where the run made it happen: the page reads once a second. */
const TOLERANCE_MS = 1_500;

/** When the page made each thing happen, in ms from the start of the file by its own clock. */
interface Clock {
  joinedAt: number;
  leftAt: number;
  pausedAt: number;
  resumedAt: number;
}

/** The notes of one recording, and its saved file's length. */
interface Saved {
  document: MeetingNotesDocument;
  text: string;
  md: string;
  fileMs: number;
}

/** The section of the notes under `heading`, up to the next one. */
const section = (text: string, heading: string): string[] => {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.startsWith(heading));
  const to = lines.findIndex((line, index) => index > from && line.startsWith('## '));
  return from === -1 ? [] : lines.slice(from, to === -1 ? undefined : to);
};

function printNotes({ md, text, document }: Saved): void {
  console.log(`  ${path.basename(md)}:`);
  for (const line of [...section(text, '## Participants'), ...section(text, '## Timeline')]) {
    if (line !== '') console.log(`    ${line}`);
  }
  for (const { seq, type, mediaMs, at, source, ...fields } of document.events) {
    console.log(`    ${seq} ${type} @${mediaMs} ms ${JSON.stringify(fields)}`);
  }
}

/** The recording the call started, once its first chunk is stored. */
async function recordingOf(page: Page): Promise<string> {
  const id = await waitFor('the recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    `a chunk of ${id} stored`,
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 0,
    20_000,
  );
  return id;
}

/** Waits until the card shows `state`. */
const cardSays = (page: Page, state: string) =>
  waitFor(`the card saying ${state}`, async () => (await overlayState(page)) === state, 10_000);

/** The call: someone joins and leaves, then a pause, then the stop. */
async function peopleCall({ browser, target }: ScenarioContext): Promise<Saved & { clock: Clock }> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    await page.click('#start');
    await recordingOf(page);
    await sleep(2_000);
    const startedAt = await recordingStartedAt(page);
    // The page's own clock, read in the task that makes each change: a page that froze (Zoom's
    // worker canvas can hold it for 10 s) makes the change only once it runs again.
    const since = async () => (await page.evaluate(() => Date.now())) - startedAt;
    const joinedAt =
      (await page.evaluate((name) => {
        window.__fixture.addParticipant({ name });
        return Date.now();
      }, NEWCOMER)) - startedAt;
    await sleep(STAY_MS);
    const leftAt =
      (await page.evaluate((name) => {
        window.__fixture.removeParticipant(name);
        return Date.now();
      }, NEWCOMER)) - startedAt;
    await sleep(STAY_MS);
    const pausedAt = await since();
    await pressCardButton(page, 'Pause');
    await cardSays(page, 'paused');
    await sleep(PAUSE_MS);
    const resumedAt = await since();
    await pressCardButton(page, 'Resume');
    await cardSays(page, 'recording');
    await sleep(5_000);
    await pressCardButton(page, 'Stop');
    const webm = await waitForNewRecording(before);
    const { md, text, document } = await waitForNotes(webm);
    const fileMs = (await inspectWebm(webm)).durationS * 1000;
    const clock = { joinedAt, leftAt, pausedAt, resumedAt };
    console.log(`  the page's clock at each step, ms into the file: ${JSON.stringify(clock)}`);
    console.log(`  ${path.basename(webm)}: ${fileMs.toFixed(0)} ms; ffprobe: ${ffprobe(webm)}`);
    return { document, text, md, fileMs, clock };
  } finally {
    await page.evaluate(() => window.__fixture.hangup());
    await page.close();
  }
}

const near = (label: string, actual: number | null | undefined, expected: number): string[] =>
  actual != null && Math.abs(actual - expected) <= TOLERANCE_MS
    ? []
    : [`${label} at ${String(actual)} ms, not ${expected} ms`];
const same = (label: string, actual: unknown, expected: unknown): string[] =>
  actual === expected
    ? []
    : [`${label} ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`];

/** The people: the user, the person there from the start, the newcomer's one span. */
function checkParticipants(document: MeetingNotesDocument, target: FixtureTarget, clock: Clock) {
  const { participants } = document;
  const user = participants.find((participant) => participant.self === true);
  const remote = participants.find((participant) => participant.name === target.names.remote);
  const newcomer = participants.find((participant) => participant.name === NEWCOMER);
  const span = newcomer?.spans[0];
  return [
    ...same('the user', user ? 'listed' : 'missing', 'listed'),
    ...same('the user is p1:', user?.id, 'p1'),
    ...same('their name', user?.name ?? null, target.supports.self ? target.names.self : null),
    ...same(`${target.names.remote} there at the start:`, remote?.presentAtStart, true),
    ...same(`${target.names.remote} there at the end:`, remote?.presentAtEnd, true),
    ...same('the newcomer there at the start:', newcomer?.presentAtStart, false),
    ...same('the newcomer there at the end:', newcomer?.presentAtEnd, false),
    ...same('the newcomer in spans:', newcomer?.spans.length, 1),
    ...near('the newcomer joined', span?.joinedMs, clock.joinedAt),
    ...near('the newcomer left', span?.leftMs, clock.leftAt),
    ...same('joins and leaves are', document.capture.signals.joinLeave, 'observed'),
  ];
}

/** Where `type` of the newcomer, or the recording, is in the file. */
const positionOf = (events: readonly NotesEvent[], type: string, id?: string) =>
  events.find(
    (event) =>
      event.type === type &&
      (id === undefined || ('participant' in event && event.participant === id)),
  )?.mediaMs;

/** The timeline: the join, the leave and the pause where the run made them, in that order. */
function checkTimeline({ document, text, fileMs }: Saved, clock: Clock): string[] {
  const { events } = document;
  const id = document.participants.find((participant) => participant.name === NEWCOMER)?.id;
  const rows = section(text, '## Timeline');
  const row = (words: string) => rows.findIndex((line) => line.includes(words));
  const escaped = NEWCOMER.replace('|', '\\|');
  const order = [row(`Joined: ${escaped}`), row(`Left: ${escaped}`), row('You paused')];
  const beyond = events.filter((event) => event.mediaMs > fileMs + TOLERANCE_MS);
  return [
    ...near('joined', positionOf(events, 'participant-joined', id), clock.joinedAt),
    ...near('left', positionOf(events, 'participant-left', id), clock.leftAt),
    ...near('paused', positionOf(events, 'recording-paused'), clock.pausedAt),
    ...near('resumed', positionOf(events, 'recording-resumed'), clock.pausedAt),
    ...near('the pause lasted', document.recording.pausedMs, clock.resumedAt - clock.pausedAt),
    ...same(
      'the timeline rows join, leave, pause are at',
      order.every((index, at) => index > (order[at - 1] ?? 0)),
      true,
    ),
    ...same('events past the end of the file', beyond.map((event) => event.type).join(), ''),
  ];
}

async function scenarioPeopleAndShares(context: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${context.target.id} scenario 99: the notes say who was in the call, and who joined and left, where it happened`,
  );
  const saved = await peopleCall(context);
  printNotes(saved);
  const problems = [
    ...checkParticipants(saved.document, context.target, saved.clock),
    ...checkTimeline(saved, saved.clock),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '99',
  after: '96',
  scenario: scenarioPeopleAndShares,
} satisfies ScenarioRegistration;
