import { describe, expect, it, vi } from 'vitest';
import { createFakeAudioContext } from '@/test/fakes/create-fake-audio-context';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { createMixer } from './create-mixer';

function setup(ctxOptions: Parameters<typeof createFakeAudioContext>[0] = {}, mixerOptions = {}) {
  const ctx = createFakeAudioContext(ctxOptions);
  let received: unknown;
  const Ctor = function (this: unknown, options: unknown) {
    received = options;
    return ctx;
  } as unknown as typeof AudioContext;
  const mixer = createMixer(document, { AudioContext: Ctor, ...mixerOptions });
  return { ctx, mixer, options: () => received };
}

describe('createMixer', () => {
  it('creates a 48 kHz playback context and exposes the destination stream', () => {
    const { ctx, mixer, options } = setup();
    expect(options()).toEqual({ sampleRate: 48_000, latencyHint: 'playback' });
    expect(mixer.stream).toBe(ctx.destinationStream);
    expect(mixer.context).toBe(ctx as unknown as AudioContext);
  });

  it('keeps a silent source connected so the audio clock runs while nothing else is', () => {
    // Firefox hands a tap zero channels from a destination without inputs (verified 2026-10-01):
    // a recording started with nobody connected would have no audio timeline at all.
    const { ctx } = setup();
    expect(ctx.constantSources).toHaveLength(1);
    expect(ctx.constantSources[0]).toMatchObject({ offset: { value: 0 }, started: true });
    expect(ctx.constantSources[0]?.connected).toEqual([ctx.streamDestination]);
  });

  it('honours a custom sample rate', () => {
    const { options } = setup({}, { sampleRate: 44_100 });
    expect(options()).toEqual({ sampleRate: 44_100, latencyHint: 'playback' });
  });

  it('falls back to the document window AudioContext, then the global', () => {
    const ctx = createFakeAudioContext();
    const Ctor = function (this: unknown) {
      return ctx;
    } as unknown as typeof AudioContext;
    expect(createMixer({ defaultView: { AudioContext: Ctor } }).context).toBe(ctx);
    vi.stubGlobal('AudioContext', Ctor);
    expect(createMixer({ defaultView: null }).context).toBe(ctx);
    vi.unstubAllGlobals();
  });

  it('mixes a track through the audio graph alone: it creates and plays no media element', () => {
    // Firefox feeds a remote WebRTC track into a MediaStreamAudioSourceNode whether or not an
    // element plays it: the graph pulls the track while its transceiver receives.
    const { ctx, mixer } = setup();
    const createElement = vi.spyOn(document, 'createElement');
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    mixer.addTrack(createFakeMediaStreamTrack());
    expect(ctx.sources[0]?.connected).toEqual([ctx.streamDestination]);
    expect(createElement).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    createElement.mockRestore();
    play.mockRestore();
  });

  it('adds audio tracks once, and ignores video', () => {
    const { ctx, mixer } = setup();
    const audio = createFakeMediaStreamTrack();
    const video = createFakeMediaStreamTrack({ kind: 'video' });
    mixer.addTrack(audio);
    mixer.addTrack(audio);
    mixer.addTrack(video);
    expect(mixer.trackCount()).toBe(1);
    expect(mixer.hasTrack(audio)).toBe(true);
    expect(mixer.hasTrack(video)).toBe(false);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.connected).toHaveLength(1);
  });

  it('removes a track when it ends or is removed explicitly', () => {
    const { ctx, mixer } = setup();
    const a = createFakeMediaStreamTrack();
    const b = createFakeMediaStreamTrack();
    mixer.addTrack(a);
    mixer.addTrack(b);
    a.end();
    expect(mixer.trackCount()).toBe(1);
    expect(ctx.sources[0]?.connected).toHaveLength(0);
    mixer.removeTrack(b);
    mixer.removeTrack(b);
    expect(mixer.trackCount()).toBe(0);
  });

  it('resumes a suspended context when tracks are added, tolerating failures', () => {
    const { ctx, mixer } = setup({ initialState: 'suspended', failResume: true });
    mixer.addTrack(createFakeMediaStreamTrack());
    mixer.resume();
    expect(ctx.resumeCalls).toBe(2);
  });

  it('does not call resume on a running context', () => {
    const { ctx, mixer } = setup();
    mixer.resume();
    expect(ctx.resumeCalls).toBe(0);
  });

  it('closes the context once and detaches all sources', async () => {
    const { ctx, mixer } = setup();
    expect(ctx.constantSources[0]?.connected).toHaveLength(1);
    mixer.addTrack(createFakeMediaStreamTrack());
    await mixer.close();
    await mixer.close();
    expect(ctx.constantSources[0]?.connected).toHaveLength(0);
    expect(ctx.sources[0]?.connected).toHaveLength(0);
    expect(ctx.state).toBe('closed');
    expect(mixer.trackCount()).toBe(0);
  });
});

describe('createMixer, the time its stream has carried', () => {
  // While the context is suspended its clock stands still, but Firefox's MediaRecorder goes on
  // writing the stream's file, with silence: that time is in the file too.
  function clocked(ctxOptions: Parameters<typeof createFakeAudioContext>[0] = {}) {
    let wall = 5_000;
    const tick = (ms: number) => {
      wall += ms;
    };
    return { ...setup(ctxOptions, { now: () => wall }), tick };
  }

  it('is the context time while it runs', () => {
    const { ctx, mixer, tick } = clocked();
    ctx.advanceGraph(1.5);
    tick(9_000);
    expect(mixer.streamTime()).toBe(1.5);
  });

  it('counts a suspension at the wall time it lasted', async () => {
    const { ctx, mixer, tick } = clocked();
    ctx.advanceGraph(1);
    ctx.suspendByPolicy();
    tick(1_000);
    expect(mixer.streamTime()).toBe(2);
    tick(1_000);
    await ctx.resume();
    ctx.advanceGraph(0.5);
    tick(500);
    expect(mixer.streamTime()).toBe(3.5);
  });

  // A new context waits until its graph has opened the audio device, seconds on a cold machine,
  // and the stream carries nothing before: the file starts once the context first runs.
  it('counts nothing before the context first runs', async () => {
    const { ctx, mixer, tick } = clocked({ initialState: 'suspended' });
    tick(1_500);
    expect(mixer.streamTime()).toBe(0);
    await ctx.resume();
    ctx.advanceGraph(1);
    tick(1_000);
    expect(mixer.streamTime()).toBe(1);
    ctx.suspendByPolicy();
    tick(500);
    expect(mixer.streamTime()).toBe(1.5);
  });

  it('reads the page clock when given none', () => {
    const { ctx, mixer } = setup();
    ctx.suspendByPolicy();
    expect(mixer.streamTime()).toBeGreaterThanOrEqual(0);
  });
});
