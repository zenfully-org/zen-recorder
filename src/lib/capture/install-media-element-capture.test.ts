import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMediaCaptureWindow,
  type FakeMediaCaptureWindow,
} from '@/test/fakes/create-fake-media-capture-window';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { installMediaElementCapture } from './install-media-element-capture';

function setup(page: FakeMediaCaptureWindow = createFakeMediaCaptureWindow()) {
  const added: MediaStreamTrack[] = [];
  const ended: MediaStreamTrack[] = [];
  const listener = {
    remoteAudioTrackAdded: (track: MediaStreamTrack) => added.push(track),
    remoteAudioTrackEnded: (track: MediaStreamTrack) => ended.push(track),
    connectionsChanged: vi.fn(),
  };
  const capture = installMediaElementCapture(page.win, listener, 500);
  return { page, capture, added, ended, listener, rescan: () => vi.advanceTimersByTime(500) };
}

/** What a page does to play a stream: a detached element, `srcObject`, play. */
function play(page: FakeMediaCaptureWindow, tracks: MediaStreamTrack[], state = {}) {
  const audio = page.createAudio(state);
  audio.srcObject = new MediaStream(tracks);
  return audio;
}

describe('installMediaElementCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the audio a page plays through a media element, at the next scan', () => {
    const { page, capture, added, listener, rescan } = setup();
    const voice = createFakeMediaStreamTrack({ id: 'voice' });
    const audio = play(page, [voice]);
    // Not at assignment: a page may mute the element or start playing right after it.
    expect(added).toEqual([]);
    expect(capture.anyConnected()).toBe(false);
    rescan();
    expect(added).toEqual([voice]);
    expect(capture.remoteAudioTracks()).toEqual([voice]);
    expect(capture.anyConnected()).toBe(true);
    expect(capture.connectionCount()).toBe(1);
    expect(listener.connectionsChanged).toHaveBeenCalledTimes(1);
    expect(audio.srcObject?.constructor).toBe(MediaStream);
    rescan();
    expect(added).toEqual([voice]);
    expect(listener.connectionsChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    // What the person does not hear is not the meeting's audio (Zoom keeps a silent element).
    ['muted', { muted: true }],
    ['not playing', { paused: true }],
    ['turned down to zero', { volume: 0 }],
  ])('ignores an element that is %s', (_label, state) => {
    const { page, capture, added, listener, rescan } = setup();
    play(page, [createFakeMediaStreamTrack()], state);
    rescan();
    expect(added).toEqual([]);
    expect(capture.remoteAudioTracks()).toEqual([]);
    expect(listener.connectionsChanged).not.toHaveBeenCalled();
  });

  it('ignores video tracks, ended tracks and sources that are not streams', () => {
    const { page, capture, rescan } = setup();
    const done = createFakeMediaStreamTrack();
    done.setReadyState('ended');
    play(page, [createFakeMediaStreamTrack({ kind: 'video' }), done]);
    page.createAudio().srcObject = new Blob(['not a stream']);
    page.createAudio().srcObject = null;
    rescan();
    expect(capture.remoteAudioTracks()).toEqual([]);
  });

  it('follows an element as it becomes audible and stops being so', () => {
    const { page, capture, added, ended, listener, rescan } = setup();
    const voice = createFakeMediaStreamTrack({ id: 'voice' });
    const audio = play(page, [voice], { muted: true });
    rescan();
    audio.muted = false;
    rescan();
    expect(added).toEqual([voice]);
    audio.muted = true;
    rescan();
    expect(ended).toEqual([voice]);
    expect(capture.anyConnected()).toBe(false);
    expect(listener.connectionsChanged).toHaveBeenCalledTimes(2);
  });

  it('notices tracks that reach the stream later and tracks that end', () => {
    const { page, capture, added, ended, rescan } = setup();
    const first = createFakeMediaStreamTrack({ id: 'first' });
    const audio = play(page, []);
    rescan();
    expect(added).toEqual([]);
    audio.srcObject = new MediaStream([first]);
    rescan();
    expect(added).toEqual([first]);
    first.setReadyState('ended');
    rescan();
    expect(ended).toEqual([first]);
    expect(capture.remoteAudioTracks()).toEqual([]);
  });

  it('lets go of an element whose stream was taken away, and picks it up again', () => {
    const { page, capture, added, ended, rescan } = setup();
    const voice = createFakeMediaStreamTrack({ id: 'voice' });
    const audio = play(page, [voice]);
    rescan();
    audio.srcObject = null;
    rescan();
    expect(ended).toEqual([voice]);
    expect(capture.connectionCount()).toBe(0);
    audio.srcObject = new MediaStream([voice]);
    rescan();
    expect(added).toEqual([voice, voice]);
  });

  it('reports a track once, however many elements play it', () => {
    const { page, capture, added, ended, rescan } = setup();
    const voice = createFakeMediaStreamTrack({ id: 'voice' });
    const one = play(page, [voice]);
    const two = play(page, [voice]);
    rescan();
    expect(added).toEqual([voice]);
    expect(capture.connectionCount()).toBe(1);
    one.srcObject = null;
    rescan();
    expect(ended).toEqual([]);
    two.srcObject = null;
    rescan();
    expect(ended).toEqual([voice]);
  });

  it('hands every value to the native setter, whatever it is', () => {
    const { page } = setup();
    const stream = new MediaStream([]);
    const audio = page.createAudio();
    audio.srcObject = stream;
    audio.srcObject = null;
    expect(page.assigned).toEqual([stream, null]);
  });

  it('restores the accessor and stops scanning on uninstall', () => {
    const page = createFakeMediaCaptureWindow();
    const before = Object.getOwnPropertyDescriptor(
      page.win.HTMLMediaElement.prototype,
      'srcObject',
    );
    const { capture, added, rescan } = setup(page);
    expect(
      Object.getOwnPropertyDescriptor(page.win.HTMLMediaElement.prototype, 'srcObject')?.set,
    ).not.toBe(before?.set);
    play(page, [createFakeMediaStreamTrack()]);
    capture.uninstall();
    expect(
      Object.getOwnPropertyDescriptor(page.win.HTMLMediaElement.prototype, 'srcObject'),
    ).toEqual(before);
    play(page, [createFakeMediaStreamTrack()]);
    rescan();
    expect(added).toEqual([]);
  });

  it('leaves the accessor alone on uninstall when someone else patched it afterwards', () => {
    const { page, capture } = setup();
    const proto = page.win.HTMLMediaElement.prototype;
    const theirs = { configurable: true, get: () => null, set: () => undefined };
    Object.defineProperty(proto, 'srcObject', theirs);
    capture.uninstall();
    expect(Object.getOwnPropertyDescriptor(proto, 'srcObject')?.set).toBe(theirs.set);
  });

  it('stays inert where the accessor cannot be hooked', () => {
    const page = createFakeMediaCaptureWindow({ withoutAccessor: true });
    const { capture, added, rescan } = setup(page);
    Object.assign(page.createAudio(), {
      srcObject: new MediaStream([createFakeMediaStreamTrack()]),
    });
    rescan();
    expect(added).toEqual([]);
    expect(capture.remoteAudioTracks()).toEqual([]);
    expect(capture.anyConnected()).toBe(false);
    expect(capture.connectionCount()).toBe(0);
    expect(() => capture.uninstall()).not.toThrow();
  });
});
