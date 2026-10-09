import { describe, expect, it } from 'vitest';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import {
  createRemoteAudioTracks,
  type RemoteAudioTrackListener,
} from './create-remote-audio-tracks';

function setUp() {
  const added: string[] = [];
  const ended: string[] = [];
  const listener: RemoteAudioTrackListener<EventTarget> = {
    remoteAudioTrackAdded: (track) => added.push(track.id),
    remoteAudioTrackEnded: (track) => ended.push(track.id),
  };
  const pc = new EventTarget();
  return { remote: createRemoteAudioTracks(listener), pc, added, ended };
}

describe('createRemoteAudioTracks', () => {
  it('counts a remote audio track once and reports its end once', () => {
    const { remote, pc, added, ended } = setUp();
    const track = createFakeMediaStreamTrack({ id: 'a1' });
    remote.add(track, pc);
    remote.add(track, pc);
    expect(added).toEqual(['a1']);
    expect([...remote.tracks.keys()]).toEqual(['a1']);
    track.end();
    track.end();
    expect(ended).toEqual(['a1']);
    expect(remote.tracks.size).toBe(0);
  });

  it('ignores video tracks and tracks that already ended', () => {
    const { remote, pc, added } = setUp();
    const finished = createFakeMediaStreamTrack({ id: 'e1' });
    finished.setReadyState('ended');
    remote.add(createFakeMediaStreamTrack({ id: 'v1', kind: 'video' }), pc);
    remote.add(finished, pc);
    expect(added).toEqual([]);
  });

  // Firefox gives a received track no audio and keeps it muted until its first packet arrives;
  // Meet negotiates a few audio slots per call, and their tracks exist before anyone fills them.
  it('counts a muted track only once its first audio arrives', () => {
    const { remote, pc, added } = setUp();
    const slot = createFakeMediaStreamTrack({ id: 'slot', muted: true });
    remote.add(slot, pc);
    remote.add(slot, pc);
    remote.prune();
    expect(added).toEqual([]);
    expect(remote.tracks.size).toBe(0);
    slot.setMuted(false);
    remote.add(slot, pc);
    expect(added).toEqual(['slot']);
    expect([...remote.tracks.keys()]).toEqual(['slot']);
  });

  it('keeps counting a track that goes muted again', () => {
    const { remote, pc, added, ended } = setUp();
    const slot = createFakeMediaStreamTrack({ id: 'slot', muted: true });
    remote.add(slot, pc);
    slot.setMuted(false);
    slot.setMuted(true);
    remote.add(slot, pc);
    remote.prune();
    expect(added).toEqual(['slot']);
    expect(ended).toEqual([]);
    expect(remote.tracks.size).toBe(1);
  });

  it('forgets a muted track that ends before any audio, without reporting an end', () => {
    const { remote, pc, added, ended } = setUp();
    const slot = createFakeMediaStreamTrack({ id: 'slot', muted: true });
    remote.add(slot, pc);
    slot.end();
    remote.prune();
    slot.setMuted(false);
    expect(added).toEqual([]);
    expect(ended).toEqual([]);
    expect(remote.tracks.size).toBe(0);
  });

  it('prunes the tracks that ended without an event, reporting each once', () => {
    const { remote, pc, ended } = setUp();
    const stopped = createFakeMediaStreamTrack({ id: 'stopped' });
    const live = createFakeMediaStreamTrack({ id: 'live' });
    remote.add(stopped, pc);
    remote.add(live, pc);
    stopped.stop();
    remote.prune();
    remote.prune();
    stopped.end();
    expect(ended).toEqual(['stopped']);
    expect([...remote.tracks.keys()]).toEqual(['live']);
  });
});
