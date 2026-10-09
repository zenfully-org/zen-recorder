import { describe, expect, it } from 'vitest';
import { createFrameStats } from '@/lib/video/create-frame-stats';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { readPageDebug } from './read-page-debug';

const notesDebug = { protocol: 1, lastSeq: 0, pending: 1, acked: -1 };
const notes = { debug: () => notesDebug };
const stoppedBacklog = { withVideo: 0, audioOnly: 0 };
const sources = { pageBacklog: { stoppedByKind: () => stoppedBacklog }, notes };
const capture = (tracks: MediaStreamTrack[], connections = 1) => ({
  connectionCount: () => connections,
  remoteAudioTracks: () => tracks,
});

describe('readPageDebug', () => {
  it('describes the page with no recording running', () => {
    const track = createFakeMediaStreamTrack({ id: 'r1' });
    Object.defineProperty(track, 'muted', { value: true }); // no audio has reached it yet
    expect(readPageDebug(capture([track]), true, null, sources)).toEqual({
      connections: 1,
      remoteAudioTracks: [{ id: 'r1', muted: true, enabled: true, readyState: 'live' }],
      admitted: true,
      video: null,
      backlog: null,
      stoppedBacklog,
      clock: null,
      notes: notesDebug,
    });
  });

  it("adds the running recording's video, backlog and clock", () => {
    const stats = { ...createFrameStats().snapshot(), ticks: 9, encoded: 8 };
    const recording = {
      video: { fps: () => 15, stats: () => stats },
      sender: { pendingBytes: () => 100, pending: () => 1 },
      encoder: { mediaTimeMs: () => 2500, state: (): RecordingState => 'paused' },
    };
    const debug = readPageDebug(capture([]), true, recording, sources);
    expect(debug).toMatchObject({
      video: { fps: 15, ticks: 9, encoded: 8 },
      backlog: { bytes: 100, chunks: 1 },
      clock: { mediaMs: 2500, paused: true },
    });
  });

  it('reports no video for a recording without it', () => {
    const recording = {
      video: null,
      sender: { pendingBytes: () => 0, pending: () => 0 },
      encoder: { mediaTimeMs: () => 0, state: (): RecordingState => 'recording' },
    };
    const debug = readPageDebug(capture([], 0), false, recording, sources);
    expect(debug).toMatchObject({ video: null, clock: { mediaMs: 0, paused: false } });
  });
});
