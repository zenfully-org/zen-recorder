import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { describeOverlayState, type OverlayView } from './describe-overlay-state';

const NOW = 1_000_000;

function snapshot(patch: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: 'r',
    recordingStartedAt: NOW - 65_000,
    remoteTracks: 1,
    micLabel: 'USB mic',
    connected: true,
    admitted: true,
    ...patch,
  };
}

describe('describeOverlayState', () => {
  it.each<{ label: string; snap: TabSnapshot; view: Omit<OverlayView, 'microphone' | 'video'> }>([
    {
      label: 'recording',
      snap: snapshot(),
      view: {
        tone: 'recording',
        status: 'Recording',
        elapsed: '01:05',
        actions: ['pause', 'stop'],
      },
    },
    {
      label: 'paused',
      snap: snapshot({ state: 'paused' }),
      view: { tone: 'paused', status: 'Paused', elapsed: '01:05', actions: ['resume', 'stop'] },
    },
    {
      // A recording that failed while paused: the next one starts on Resume.
      label: 'paused before its next recording',
      snap: snapshot({ state: 'paused', recordingId: null, recordingStartedAt: null }),
      view: { tone: 'paused', status: 'Paused', elapsed: '', actions: ['resume', 'stop'] },
    },
    {
      label: 'stopping',
      snap: snapshot({ state: 'stopping' }),
      view: { tone: 'saving', status: 'Saving…', elapsed: '', actions: [] },
    },
    {
      label: 'waiting in the lobby',
      snap: snapshot({ state: 'waiting', recordingId: null, admitted: false }),
      view: { tone: 'waiting', status: 'Waiting to be admitted', elapsed: '', actions: ['start'] },
    },
    {
      label: 'waiting alone',
      snap: snapshot({ state: 'waiting', remoteTracks: 0, recordingId: null }),
      view: {
        tone: 'waiting',
        status: 'Waiting for participants',
        elapsed: '',
        actions: ['start'],
      },
    },
    {
      label: 'waiting with people',
      snap: snapshot({ state: 'waiting', recordingId: null }),
      view: { tone: 'waiting', status: 'Ready to record', elapsed: '', actions: ['start'] },
    },
    {
      label: 'idle before the call connects',
      snap: snapshot({ state: 'idle', connected: false, remoteTracks: 0, recordingId: null }),
      view: { tone: 'waiting', status: 'Ready to record', elapsed: '', actions: ['start'] },
    },
  ])('describes $label', ({ snap, view }) => {
    expect(describeOverlayState(snap, NOW)).toMatchObject(view);
  });

  it('names the microphone, or says none was found yet', () => {
    expect(describeOverlayState(snapshot(), NOW).microphone).toBe('USB mic');
    expect(describeOverlayState(snapshot({ micLabel: null }), NOW).microphone).toBe(
      'Not detected yet',
    );
  });

  it('counts the video tiles a recording holds, or says it records audio only', () => {
    const video = (patch: Partial<TabSnapshot>) => describeOverlayState(snapshot(patch), NOW).video;
    expect(video({ videoTiles: 1 })).toBe('1 tile');
    expect(video({ state: 'paused', videoTiles: 4 })).toBe('4 tiles');
    expect(video({ videoTiles: 0 })).toBe('0 tiles');
    expect(video({})).toBe('Audio only');
    expect(video({ state: 'waiting', recordingId: null, videoTiles: 2 })).toBeNull();
    expect(video({ state: 'stopping', videoTiles: 2 })).toBeNull();
  });
});
