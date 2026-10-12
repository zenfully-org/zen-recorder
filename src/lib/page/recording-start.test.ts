import { describe, expect, it } from 'vitest';
import { recordingStart } from './recording-start';

/** A recording that started by itself, the first of its meeting. */
const AUTO = {
  cause: 'auto-first-remote',
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
} as const;

const recording = (video: boolean) => ({
  id: 'r1',
  startedAt: 1_700_000_000_000,
  encoder: { mimeType: () => (video ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus') },
  video: video ? {} : null,
});

describe('recordingStart', () => {
  it('names the meeting as the page shows it when the recording starts', () => {
    expect(
      recordingStart(recording(false), {
        provider: 'meet',
        meeting: { meetingCode: 'abc-defg-hij', title: 'Standup' },
        mic: { label: 'Built-in microphone' },
        facts: AUTO,
      }),
    ).toEqual({
      recordingId: 'r1',
      provider: 'meet',
      meetingCode: 'abc-defg-hij',
      title: 'Standup',
      startedAt: 1_700_000_000_000,
      mimeType: 'audio/webm;codecs=opus',
      micLabel: 'Built-in microphone',
      eventsProtocol: 1,
      tickMs: 1_000,
      startCause: 'auto-first-remote',
    });
  });

  it('says when the recording carries video, and when the meeting or microphone is unknown', () => {
    expect(
      recordingStart(recording(true), {
        provider: 'teams',
        meeting: { meetingCode: null, title: 'Call' },
        mic: null,
        facts: AUTO,
      }),
    ).toEqual({
      recordingId: 'r1',
      provider: 'teams',
      meetingCode: 'unknown',
      title: 'Call',
      startedAt: 1_700_000_000_000,
      mimeType: 'video/webm;codecs=vp9,opus',
      micLabel: null,
      hasVideo: true,
      eventsProtocol: 1,
      tickMs: 1_000,
      startCause: 'auto-first-remote',
    });
  });

  // The notes' header has them even when the start event never reaches the background.
  it('says why it started, why it has no video, and which recording it goes on from', () => {
    const facts = {
      cause: 'restart-after-video-failure',
      audioOnlyReason: 'video-failed',
      continuesRecordingId: 'r0',
      gapMs: 0,
    } as const;
    expect(
      recordingStart(recording(false), {
        provider: 'zoom',
        meeting: { meetingCode: '123', title: 'Sync' },
        mic: null,
        facts,
      }),
    ).toMatchObject({
      startCause: 'restart-after-video-failure',
      audioOnlyReason: 'video-failed',
      continuesRecordingId: 'r0',
      gapMs: 0,
    });
  });
});
