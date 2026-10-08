import { describe, expect, it } from 'vitest';
import type { TabToBackground } from '@/lib/types';
import { createStoreAlerts } from './create-store-alerts';

const FIRST = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const SECOND = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const FULL = new DOMException(
  'The current transaction exceeded its quota limitations.',
  'QuotaExceededError',
);
const DISK_FULL =
  'the disk is full, so this recording cannot be saved for now. Free some space and keep this tab open: it holds what it records until there is room.';

const chunk = (recordingId: string, seq: number): TabToBackground => ({
  type: 'chunk',
  chunk: { recordingId, seq, blob: new Blob(['x']), timestampMs: seq * 3000 },
});
const ended = (recordingId: string): TabToBackground => ({
  type: 'recordingEnded',
  info: { recordingId, chunkCount: 2, durationMs: 6000, reason: 'command' },
});
const told = (recordingId: string, message = DISK_FULL) => ({
  type: 'error',
  recordingId,
  message,
});

describe('createStoreAlerts', () => {
  it('tells the tab once when its chunks cannot be stored, however often the page sends them again', () => {
    const alerts = createStoreAlerts();
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toEqual(told(FIRST));
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toBeNull();
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toBeNull();
  });

  it('tells it again only once what failed was stored', () => {
    const alerts = createStoreAlerts();
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toEqual(told(FIRST));
    alerts.stored(1, chunk(FIRST, 4));
    expect(alerts.failed(1, chunk(FIRST, 9), FULL)).toEqual(told(FIRST));
  });

  it('keeps quiet while any recording of the tab still cannot be stored', () => {
    const alerts = createStoreAlerts();
    // A stopped recording's chunks still wait in the page beside the running one's.
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toEqual(told(FIRST));
    expect(alerts.failed(1, chunk(SECOND, 0), FULL)).toBeNull();
    alerts.stored(1, chunk(SECOND, 0));
    expect(alerts.failed(1, chunk(SECOND, 1), FULL)).toBeNull();
    alerts.stored(1, chunk(SECOND, 1));
    alerts.stored(1, chunk(FIRST, 4));
    expect(alerts.failed(1, chunk(SECOND, 2), FULL)).toEqual(told(SECOND));
  });

  it('counts an end the store refused like a chunk', () => {
    const alerts = createStoreAlerts();
    expect(alerts.failed(1, ended(FIRST), FULL)).toEqual(told(FIRST));
    expect(alerts.failed(1, ended(FIRST), FULL)).toBeNull();
    alerts.stored(1, ended(FIRST));
    expect(alerts.failed(1, chunk(FIRST, 0), FULL)).toEqual(told(FIRST));
  });

  it('does not take an announcement for stored: the background keeps one the store refused', () => {
    const alerts = createStoreAlerts();
    expect(alerts.failed(1, chunk(FIRST, 0), FULL)).toEqual(told(FIRST));
    alerts.stored(1, {
      type: 'recordingStarted',
      info: {
        recordingId: FIRST,
        provider: 'meet',
        meetingCode: 'abc-defg-hij',
        title: 'Standup',
        startedAt: 5,
        mimeType: 'audio/webm',
        micLabel: null,
      },
    });
    expect(alerts.failed(1, chunk(FIRST, 0), FULL)).toBeNull();
  });

  it('tells nothing about a message that names no recording', () => {
    const alerts = createStoreAlerts();
    const log: TabToBackground = { type: 'log', log: { level: 'info', message: 'hello' } };
    expect(alerts.failed(1, log, FULL)).toBeNull();
    alerts.stored(1, log);
    expect(alerts.failed(1, chunk(FIRST, 0), FULL)).toEqual(told(FIRST));
  });

  it('tells each tab about its own recordings', () => {
    const alerts = createStoreAlerts();
    // A tab that never failed has nothing to clear.
    alerts.stored(3, chunk(FIRST, 0));
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toEqual(told(FIRST));
    expect(alerts.failed(2, chunk(SECOND, 0), FULL)).toEqual(told(SECOND));
    alerts.stored(2, chunk(SECOND, 0));
    expect(alerts.failed(1, chunk(FIRST, 4), FULL)).toBeNull();
    expect(alerts.failed(2, chunk(SECOND, 1), FULL)).toEqual(told(SECOND));
  });

  it.each([
    {
      cause: 'a database the browser closed',
      error: new DOMException(
        'A mutation operation was attempted on a database that did not allow mutations.',
        'InvalidStateError',
      ),
      words:
        "the browser's storage refuses this recording (InvalidStateError), so it cannot be saved for now. Keep this tab open: it holds what it records until storing works again.",
    },
    {
      cause: 'something thrown that is no error',
      error: 'disk on fire',
      words:
        "the browser's storage refuses this recording (disk on fire), so it cannot be saved for now. Keep this tab open: it holds what it records until storing works again.",
    },
  ])('says what went wrong for $cause', ({ error, words }) => {
    expect(createStoreAlerts().failed(1, chunk(FIRST, 0), error)).toEqual(told(FIRST, words));
  });
});
