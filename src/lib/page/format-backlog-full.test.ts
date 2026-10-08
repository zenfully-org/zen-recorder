import { describe, expect, it } from 'vitest';
import { formatBacklogFull } from './format-backlog-full';

const MiB = 2 ** 20;

describe('formatBacklogFull', () => {
  it.each([
    {
      name: 'a recording with video alone fills the limit',
      hasVideo: true,
      backlog: { bytes: 64.2 * MiB, chunks: 120, spanMs: 205_400, elsewhereBytes: 0 },
      line: 'backlog full: 64.2 MiB of recording r1 (its last 205 s) wait for the extension, more than the 64.0 MiB the page holds. The video stops here; the rest of the meeting records audio only',
    },
    {
      name: 'an audio-only recording fills it with the chunks of earlier ones',
      hasVideo: false,
      backlog: { bytes: 100 * 1024, chunks: 4, spanMs: 9_200, elsewhereBytes: 35 * 1024 },
      line: 'backlog full: 100 KiB of recording r1 (its last 9 s) and 35 KiB of earlier recordings wait for the extension, more than the 64.0 MiB the page holds. The recording stops here; the next one starts once the extension has taken them',
    },
  ])('says how much waits, and what records next, when $name', ({ hasVideo, backlog, line }) => {
    expect(
      formatBacklogFull({
        recordingId: 'r1',
        hasVideo,
        backlog: { ...backlog, limitBytes: 64 * MiB },
      }),
    ).toBe(line);
  });
});
