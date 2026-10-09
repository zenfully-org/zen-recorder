import { describe, expect, it } from 'vitest';
import { recordingStart } from './recording-start';

const recording = (video: boolean) => ({
  id: 'r1',
  startedAt: 1_700_000_000_000,
  encoder: { mimeType: () => (video ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus') },
  video: video ? {} : null,
});

describe('recordingStart', () => {
  it('names the meeting as the page shows it when the recording starts', () => {
    expect(
      recordingStart(
        recording(false),
        'meet',
        { meetingCode: 'abc-defg-hij', title: 'Standup' },
        {
          label: 'Built-in microphone',
        },
      ),
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
    });
  });

  it('says when the recording carries video, and when the meeting or microphone is unknown', () => {
    expect(
      recordingStart(recording(true), 'teams', { meetingCode: null, title: 'Call' }, null),
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
    });
  });
});
