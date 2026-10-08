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
    const windowed = {
      defaultView: { AudioContext: Ctor },
      createElement: document.createElement.bind(document),
    };
    expect(createMixer(windowed as unknown as Document).context).toBe(ctx);
    vi.stubGlobal('AudioContext', Ctor);
    expect(createMixer({ defaultView: null } as unknown as Document).context).toBe(ctx);
    vi.unstubAllGlobals();
  });

  it('adds audio tracks once, with a muted element sink, and ignores video', () => {
    const { ctx, mixer } = setup();
    const audio = createFakeMediaStreamTrack();
    const video = createFakeMediaStreamTrack({ kind: 'video' });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new Error('autoplay'));
    mixer.addTrack(audio);
    mixer.addTrack(audio);
    mixer.addTrack(video);
    expect(mixer.trackCount()).toBe(1);
    expect(mixer.hasTrack(audio)).toBe(true);
    expect(mixer.hasTrack(video)).toBe(false);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.connected).toHaveLength(1);
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  it('keeps recording when the element sink cannot be created', () => {
    const ctx = createFakeAudioContext();
    const Ctor = function (this: unknown) {
      return ctx;
    } as unknown as typeof AudioContext;
    const doc = {
      defaultView: null,
      createElement: () => {
        throw new Error('no audio element here');
      },
    } as unknown as Document;
    const mixer = createMixer(doc, { AudioContext: Ctor });
    mixer.addTrack(createFakeMediaStreamTrack());
    expect(mixer.trackCount()).toBe(1);
    expect(() => mixer.removeTrack(createFakeMediaStreamTrack())).not.toThrow();
  });

  it('can skip element sinks', () => {
    const { mixer } = setup({}, { elementSinks: false });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    mixer.addTrack(createFakeMediaStreamTrack());
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('removes a track when it ends or is removed explicitly', () => {
    const { ctx, mixer } = setup({}, { elementSinks: false });
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
    const { ctx, mixer } = setup(
      { initialState: 'suspended', failResume: true },
      { elementSinks: false },
    );
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
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    mixer.addTrack(createFakeMediaStreamTrack());
    await mixer.close();
    await mixer.close();
    expect(ctx.constantSources[0]?.connected).toHaveLength(0);
    expect(ctx.state).toBe('closed');
    expect(mixer.trackCount()).toBe(0);
    play.mockRestore();
  });
});
