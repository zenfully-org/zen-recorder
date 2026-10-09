import { describe, expect, it } from 'vitest';
import { formatRecordingStarted } from './format-recording-started';

describe('formatRecordingStarted', () => {
  it.each([
    ['audio only', null, 'recording started (audio/webm;codecs=opus)'],
    [
      'with video',
      { width: 1920, height: 1080, fps: 15 },
      'recording started (audio/webm;codecs=opus, video 1920x1080@15)',
    ],
  ])('names the format, %s', (_label, plan, line) => {
    expect(formatRecordingStarted('audio/webm;codecs=opus', plan)).toBe(line);
  });
});
