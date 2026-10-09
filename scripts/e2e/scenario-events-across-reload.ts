/**
 * E2e scenario 82, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * page's meeting events reach the background's event store across an extension reload, each
 * once and in order, and the recording's end says how many there are and why it ended.
 *
 *   - The Ports are held down (`ports:hold`) before the recording starts, so its start event
 *     cannot be delivered: the page must still hold it, unacked, a few seconds later.
 *   - The extension reloads, as an update does: a fresh background and bridge, while the page's
 *     recorder keeps running. The page sends the waiting events again, and they are acked.
 *   - After Stop, the stored events are the recording's start and stop, seqs 0 and 1, placed
 *     within 1 s of the saved file's beginning and end, and the recording's end stores its reason
 *     (`command`), 2 events, none dropped or unsent.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  EXTENSION_DIR,
  inspectWebm,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** How far the start and stop events may be from the beginning and the end of the saved file. */
const TOLERANCE_MS = 1_000;

const notesSchema = z.object({
  notes: z.object({
    protocol: z.number(),
    lastSeq: z.number(),
    pending: z.number(),
    acked: z.number(),
  }),
});

const storedSchema = z.object({
  recording: z.object({
    id: z.string(),
    status: z.string(),
    endReason: z.string().nullable(),
    eventsProtocol: z.number().nullable(),
    eventCount: z.number().nullable(),
    eventsDropped: z.number().nullable(),
    eventsUnsent: z.number().nullable(),
  }),
  events: z.array(
    z
      .object({ seq: z.number(), type: z.string(), mediaMs: z.number(), receivedAt: z.number() })
      .loose(),
  ),
});

/** What the page's notes tracker says about the newest recording's events. */
async function pageNotes(page: Page): Promise<z.infer<typeof notesSchema>['notes']> {
  const debug = notesSchema.safeParse(await page.evaluate(() => window.__zenRecorderPage?.debug()));
  if (!debug.success) throw new Error('the page keeps no meeting events (debug().notes)');
  return debug.data.notes;
}

export async function scenarioEventsAcrossReload({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 82: meeting events reach the event store across an extension reload, each once`,
  );
  const before = new Set(await listWebm());
  // Not in the call: it holds the Ports through runtime messages, which need none.
  let control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    console.log(`  hold the Ports: ${JSON.stringify(await probe(control, 'ports:hold'))}`);
    await page.bringToFront();
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    await sleep(4_000);
    const held = await pageNotes(page);
    console.log(
      `  ${id} records while the Port is down; the page's events: ${JSON.stringify(held)}`,
    );
    if (held.acked !== -1 || held.pending < 1) {
      throw new Error('the start event was not waiting in the page while the Port was down');
    }
    const reloadedAt = Date.now();
    await browser.installExtension(EXTENSION_DIR);
    await control.close();
    control = await openMeeting(browser, meetingUrl(target));
    console.log('  extension reloaded while recording');
    const delivered = await waitFor(
      'the waiting events acked after the reload',
      async () => {
        const notes = await pageNotes(page);
        return notes.acked >= 0 ? notes : null;
      },
      40_000,
    );
    console.log(
      `  acked ${Date.now() - reloadedAt} ms after the reload began: ${JSON.stringify(delivered)}`,
    );
    await sleep(2_000);
    await page.bringToFront();
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    const file = await waitForNewRecording(before);
    const info = await inspectWebm(file);
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    const stored = await waitFor(
      'the recording saved, with its events',
      async () => {
        const parsed = storedSchema.safeParse(await probe(control, 'notes:events'));
        return parsed.success &&
          parsed.data.recording.id === id &&
          parsed.data.recording.status === 'saved'
          ? parsed.data
          : null;
      },
      30_000,
    );
    console.log(`  stored recording: ${JSON.stringify(stored.recording)}`);
    for (const event of stored.events) {
      console.log(
        `  stored event: ${JSON.stringify(event)} (received ${event.receivedAt - reloadedAt} ms after the reload began)`,
      );
    }
    checkStored(stored, info.durationS * 1000);
  } catch (error) {
    console.log(`  notes:events: ${JSON.stringify(await probe(control, 'notes:events'))}`);
    throw error;
  } finally {
    await page.close();
    await control.close();
  }
}

function checkStored(stored: z.infer<typeof storedSchema>, fileMs: number): void {
  const { recording, events } = stored;
  const [start, stop] = events;
  const problems = [
    ...(events.map((event) => event.seq).join(',') === '0,1'
      ? []
      : ['the stored seqs are not 0 and 1']),
    ...(start?.type === 'recording-started' && start.mediaMs <= TOLERANCE_MS
      ? []
      : ['the first event is not the start, at the beginning of the file']),
    ...(stop?.type === 'recording-stopped' && stop['reason'] === 'command'
      ? []
      : ['the last event is not the stop by command']),
    ...(stop && Math.abs(stop.mediaMs - fileMs) <= TOLERANCE_MS
      ? []
      : [`the stop is not at the end of the file (${fileMs.toFixed(0)} ms)`]),
    ...(recording.endReason === 'command' && recording.eventsProtocol === 1
      ? []
      : ['the end reason or the events protocol is not stored']),
    ...(recording.eventCount === 2 && recording.eventsDropped === 0 && recording.eventsUnsent === 0
      ? []
      : ['the end does not count 2 events, none dropped or unsent']),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}
