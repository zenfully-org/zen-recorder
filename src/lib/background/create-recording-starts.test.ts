import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingStartedInfo } from '@/lib/types';
import { createRecordingStarts } from './create-recording-starts';

const RECORDING_ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const STARTED: RecordingStartedInfo = {
  recordingId: RECORDING_ID,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 5,
  mimeType: 'video/webm;codecs=vp9,opus',
  micLabel: 'USB mic',
  hasVideo: true,
};
const REFUSED = `could not store the start of recording ${RECORDING_ID}, so it is not listed yet; trying again with its next chunk and its end:`;

const chunk = (seq: number, text: string) => {
  const blob = new Blob([text]);
  return { recordingId: RECORDING_ID, seq, blob, byteLength: blob.size, receivedAt: 1 };
};

let counter = 0;
let store: ChunkStore;

function setup() {
  store = openChunkStore(`starts-${++counter}`);
  const stored: RecordingStartedInfo[] = [];
  const warnings: unknown[][] = [];
  const starts = createRecordingStarts({
    store,
    onRecordingStarted: (info) => stored.push(info),
    warn: (...args) => warnings.push(args),
  });
  return { starts, stored, warnings };
}

describe('createRecordingStarts', () => {
  afterEach(async () => store.close());

  it('stores an announced recording as recording, without the fields the page left out', async () => {
    const { starts, stored, warnings } = setup();
    await starts.announce(STARTED);
    expect(await store.getRecording(RECORDING_ID)).toEqual({
      id: RECORDING_ID,
      provider: 'meet',
      meetingCode: 'abc-defg-hij',
      title: 'Standup',
      startedAt: 5,
      mimeType: 'video/webm;codecs=vp9,opus',
      micLabel: 'USB mic',
      hasVideo: true,
      status: 'recording',
      chunkCount: 0,
      byteSize: 0,
    });
    expect(stored).toEqual([STARTED]);
    expect(warnings).toEqual([]);
    const other = { ...STARTED, recordingId: 'other', micLabel: null, hasVideo: false };
    await starts.announce(other);
    const plain = await store.getRecording('other');
    expect(plain).not.toHaveProperty('micLabel');
    expect(plain).not.toHaveProperty('hasVideo');
  });

  it('counts the chunks stored before the recording', async () => {
    const { starts } = setup();
    await store.putChunk(chunk(0, 'ab'));
    await store.putChunk(chunk(1, 'cde'));
    await starts.announce(STARTED);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ chunkCount: 2, byteSize: 5 });
  });

  it('keeps the running totals of a recording announced again, and says so when it is over', async () => {
    const { starts, stored, warnings } = setup();
    await starts.announce(STARTED);
    await store.updateRecording(RECORDING_ID, { chunkCount: 3, byteSize: 9 });
    await starts.announce(STARTED);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ chunkCount: 3, byteSize: 9 });
    expect(stored).toHaveLength(1);
    expect(warnings).toEqual([]);
    await store.updateRecording(RECORDING_ID, { status: 'saved' });
    await starts.announce(STARTED);
    expect(warnings).toEqual([[`recording ${RECORDING_ID} re-announced but already saved`]]);
  });

  it('keeps an announcement the store refused, says so once, and stores it with the next lookup', async () => {
    const { starts, stored, warnings } = setup();
    const failure = new DOMException('disk full', 'QuotaExceededError');
    vi.spyOn(store, 'putRecording').mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
    await starts.announce(STARTED);
    expect(starts.pending(RECORDING_ID)).toBe(true);
    expect(warnings).toEqual([[REFUSED, failure]]);
    // Refused again: nothing stored, nothing said.
    expect(await starts.stored(RECORDING_ID)).toBeUndefined();
    expect(starts.pending(RECORDING_ID)).toBe(true);
    await store.putChunk(chunk(0, 'ab'));
    expect(await starts.stored(RECORDING_ID)).toMatchObject({ status: 'recording', chunkCount: 1 });
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ byteSize: 2 });
    expect(starts.pending(RECORDING_ID)).toBe(false);
    expect(stored).toEqual([STARTED]);
    expect(warnings).toHaveLength(1);
  });

  it('looks up a stored recording, and finds none for one nobody announced', async () => {
    const { starts } = setup();
    await starts.announce(STARTED);
    expect(await starts.stored(RECORDING_ID)).toMatchObject({ title: 'Standup' });
    expect(await starts.stored('unknown')).toBeUndefined();
    expect(starts.pending('unknown')).toBe(false);
  });

  it('rejects a lookup the store cannot answer', async () => {
    const { starts } = setup();
    const failure = new DOMException('the database is closing', 'InvalidStateError');
    vi.spyOn(store, 'getRecording').mockRejectedValueOnce(failure);
    await expect(starts.stored(RECORDING_ID)).rejects.toBe(failure);
  });

  it('keeps an announcement whose recording the store could not even read', async () => {
    const { starts, warnings } = setup();
    const failure = new DOMException('the database is closing', 'InvalidStateError');
    vi.spyOn(store, 'getRecording').mockRejectedValueOnce(failure);
    await starts.announce(STARTED);
    expect(starts.pending(RECORDING_ID)).toBe(true);
    expect(warnings).toEqual([[REFUSED, failure]]);
  });

  it('stores an announcement it kept when the page announces the recording again', async () => {
    const { starts, stored } = setup();
    vi.spyOn(store, 'putRecording').mockRejectedValueOnce(new Error('disk full'));
    await starts.announce(STARTED);
    await starts.announce(STARTED);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ status: 'recording' });
    expect(starts.pending(RECORDING_ID)).toBe(false);
    expect(stored).toEqual([STARTED]);
  });
});
