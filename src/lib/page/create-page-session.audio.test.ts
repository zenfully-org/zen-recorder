/**
 * `createPageSession` with a recording whose audio has not started: the video records, but the
 * audio graph runs nothing (the browser can open no audio output), so the file would have no sound.
 * The page says so once the file is a few seconds in: once per recording in Diagnostics, and in its
 * snapshot while it lasts, which the status card, the popup and the toolbar show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPageSession as setup } from '@/test/page-session-harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const LINE = /the audio has not started 5 s into the recording/;

/** A page recording with video whose audio graph runs nothing yet. */
async function silentRecording() {
  const page = setup({ probe: { codec: 'vp9' } });
  await page.startInCall();
  const recorder = page.videoRecorders[0];
  if (!recorder) throw new Error('the page records no video');
  recorder.audio = false;
  return { ...page, recorder };
}

describe('createPageSession, a recording whose audio has not started', () => {
  it('says so once its file is 5 s in: one Diagnostics line, and the snapshot while it lasts', async () => {
    const { recorder, logs, snapshots, session } = await silentRecording();
    recorder.mediaMs = 4_900;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logs.filter((line) => LINE.test(line))).toEqual([]);
    expect(snapshots.at(-1)).not.toHaveProperty('noAudio');
    recorder.mediaMs = 5_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).toMatchObject({ state: 'recording', noAudio: true });
    recorder.mediaMs = 20_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(logs.filter((line) => LINE.test(line))).toEqual([
      expect.stringMatching(/^warn: the audio has not started 5 s into the recording: /),
    ]);
    expect(session.getSnapshot()).toMatchObject({ noAudio: true });
  });

  it('stops saying it once the audio starts', async () => {
    const { recorder, logs, snapshots } = await silentRecording();
    recorder.mediaMs = 6_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).toMatchObject({ noAudio: true });
    recorder.audio = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).not.toHaveProperty('noAudio');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(logs.filter((line) => LINE.test(line))).toHaveLength(1);
  });

  // The file's position stands still while the recording is paused: a pause is no wait.
  it('counts the time in the file, not on the wall clock', async () => {
    const { recorder, snapshots, logs } = await silentRecording();
    recorder.mediaMs = 3_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(snapshots.at(-1)).not.toHaveProperty('noAudio');
    expect(logs.filter((line) => LINE.test(line))).toEqual([]);
  });

  it('stops saying it with the recording, and says it again of the next one', async () => {
    const { recorder, logs, snapshots, session, flush, videoRecorders } = await silentRecording();
    recorder.mediaMs = 6_000;
    await vi.advanceTimersByTimeAsync(1_000);
    session.command('stop');
    await flush();
    expect(snapshots.at(-1)).not.toHaveProperty('noAudio');
    session.command('start');
    await flush();
    const next = videoRecorders[1];
    if (!next) throw new Error('Record started no recording with video');
    next.audio = false;
    next.mediaMs = 6_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).toMatchObject({ noAudio: true });
    expect(logs.filter((line) => LINE.test(line))).toHaveLength(2);
  });

  // Without video the audio is all the file holds, and it goes through the browser's recorder.
  it('says nothing of a recording without video', async () => {
    const { session, logs, snapshots, startInCall } = setup({ probe: null });
    await startInCall();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot()).toMatchObject({ state: 'recording' });
    expect(snapshots.at(-1)).not.toHaveProperty('noAudio');
    expect(logs.filter((line) => LINE.test(line))).toEqual([]);
  });
});
