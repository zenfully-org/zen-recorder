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
  it.each<{
    label: string;
    snap: TabSnapshot;
    view: Omit<OverlayView, 'microphone' | 'video' | 'alert'>;
  }>([
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
      // The page holds as much video as it may: the recording goes on audio only.
      label: 'recording audio only once the video filled the page',
      snap: snapshot({ backlogFull: 'audio-only' }),
      view: {
        tone: 'recording',
        status: 'Recording',
        elapsed: '01:05',
        actions: ['pause', 'stop'],
      },
    },
    {
      // No "Saving…": nothing is saved, and nothing records, until the extension takes them.
      label: 'waiting for the extension to take what the page holds',
      snap: snapshot({ state: 'stopping', recordingId: null, backlogFull: 'waiting' }),
      view: { tone: 'blocked', status: 'Not recording', elapsed: '', actions: [] },
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

  it('says nothing more while the page holds less than its limit', () => {
    expect(describeOverlayState(snapshot(), NOW).alert).toBeNull();
    expect(describeOverlayState(snapshot({ state: 'stopping' }), NOW).alert).toBeNull();
  });

  it('says, in a few words and in full, that the video stopped and the meeting records audio only', () => {
    expect(describeOverlayState(snapshot({ backlogFull: 'audio-only' }), NOW).alert).toEqual({
      label: 'Audio only',
      detail:
        'The video stopped: this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only. Keep this tab open until it is saved.',
      toast:
        'Zen Recorder: the video stopped, because this tab holds as much as it can of a recording that could not be saved yet. The rest of the meeting records audio only; keep this tab open until it is saved.',
    });
  });

  it('says, in a few words and in full, that nothing records until the extension took what the page holds', () => {
    const waiting = snapshot({ state: 'stopping', recordingId: null, backlogFull: 'waiting' });
    expect(describeOverlayState(waiting, NOW).alert).toEqual({
      label: 'Waiting for space',
      detail:
        'Nothing records: this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
      toast:
        'Zen Recorder: nothing records now, because this tab holds as much as it can of recordings that could not be saved yet. Keep this tab open until they are.',
    });
  });
});
