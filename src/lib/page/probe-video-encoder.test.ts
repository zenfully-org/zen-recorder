import { describe, expect, it, vi } from 'vitest';
import { probeVideoEncoder } from './probe-video-encoder';

function encoders(options: { video?: string[]; audio?: boolean; throwOn?: string } = {}) {
  const videoCalls: string[] = [];
  const canEncodeVideo = vi.fn(async (codec: 'vp9' | 'vp8') => {
    videoCalls.push(codec);
    if (codec === options.throwOn) throw new Error('encoder crashed');
    return (options.video ?? ['vp9']).includes(codec);
  });
  const canEncodeAudio = vi.fn(async () => options.audio ?? true);
  return { hasWebCodecs: true, canEncodeVideo, canEncodeAudio, videoCalls };
}

const size = { width: 1920, height: 1080, bitsPerSecond: 2_500_000 };

describe('probeVideoEncoder', () => {
  it('returns null without WebCodecs, without probing', async () => {
    const e = encoders();
    await expect(probeVideoEncoder({ ...e, hasWebCodecs: false, ...size })).resolves.toBeNull();
    expect(e.canEncodeVideo).not.toHaveBeenCalled();
  });

  it('prefers VP9 and test-encodes with the recording settings (size, bitrate, realtime)', async () => {
    const e = encoders();
    await expect(probeVideoEncoder({ ...e, ...size })).resolves.toEqual({ codec: 'vp9' });
    // Without latencyMode the test encode runs Firefox's much slower 'quality' setup.
    expect(e.canEncodeVideo).toHaveBeenCalledWith('vp9', {
      width: 1920,
      height: 1080,
      bitrate: 2_500_000,
      latencyMode: 'realtime',
    });
    expect(e.canEncodeAudio).toHaveBeenCalledWith('opus', {
      numberOfChannels: 1,
      sampleRate: 48_000,
    });
  });

  it('falls back to VP8 and then to null', async () => {
    await expect(probeVideoEncoder({ ...encoders({ video: ['vp8'] }), ...size })).resolves.toEqual({
      codec: 'vp8',
    });
    await expect(probeVideoEncoder({ ...encoders({ video: [] }), ...size })).resolves.toBeNull();
  });

  it('treats a throwing probe as unsupported', async () => {
    const e = encoders({ video: ['vp8'], throwOn: 'vp9' });
    await expect(probeVideoEncoder({ ...e, ...size })).resolves.toEqual({ codec: 'vp8' });
  });

  it('returns null when Opus cannot be encoded, without probing video', async () => {
    const e = encoders({ audio: false });
    await expect(probeVideoEncoder({ ...e, ...size })).resolves.toBeNull();
    expect(e.videoCalls).toEqual([]);
  });

  it('memoises per probe function and configuration', async () => {
    const e = encoders();
    await probeVideoEncoder({ ...e, ...size });
    await probeVideoEncoder({ ...e, ...size });
    expect(e.canEncodeVideo).toHaveBeenCalledTimes(1);
    await probeVideoEncoder({ ...e, ...size, height: 720 });
    expect(e.canEncodeVideo).toHaveBeenCalledTimes(2);
  });
});
