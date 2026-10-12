import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import type { VideoProbe } from '@/lib/video/pick-video-plan';
import { registerFakeMediabunnyEncoders } from '@/test/fakes/register-fake-mediabunny-encoders';
import { createVideoProbe, type ProbeVideo } from './create-video-probe';

const withVideo = parsePageConfig({ videoMode: 'tiles' });

function setup(
  probeVideo?: ProbeVideo,
  globals: { VideoEncoder?: unknown; AudioEncoder?: unknown } = {},
) {
  const logs: string[] = [];
  const win = {
    ...globals,
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    performance: { now: () => Date.now() },
  };
  const probe = createVideoProbe({
    win,
    probeVideo,
    log: (level, message) => logs.push(`${level}: ${message}`),
  });
  return { probe, logs };
}

/** A probe that answers when the test says. */
function heldProbe() {
  const answers: ((probe: VideoProbe | null) => void)[] = [];
  const probeVideo: ProbeVideo = () => new Promise((resolve) => answers.push(resolve));
  return {
    probeVideo,
    answer: (index: number, probe: VideoProbe | null) => answers[index]?.(probe),
  };
}

describe('createVideoProbe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the answer and says how long it took', async () => {
    const { probeVideo, answer } = heldProbe();
    const { probe, logs } = setup(probeVideo);
    expect(probe.current()).toBeNull();
    probe.refresh(withVideo);
    await vi.advanceTimersByTimeAsync(300);
    answer(0, { codec: 'vp8' });
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.current()).toEqual({ codec: 'vp8' });
    expect(logs).toEqual(['info: video probe: vp8 (300 ms)']);
  });

  it('asks nothing for a configuration without video', () => {
    const probeVideo = vi.fn<ProbeVideo>();
    setup(probeVideo).probe.refresh(parsePageConfig({ videoMode: 'off' }));
    expect(probeVideo).not.toHaveBeenCalled();
  });

  // Two probes in flight: the older one must not overwrite the newer answer.
  it('keeps only the newest answer', async () => {
    const { probeVideo, answer } = heldProbe();
    const { probe } = setup(probeVideo);
    probe.refresh(withVideo);
    probe.refresh(withVideo);
    answer(1, { codec: 'vp9' });
    answer(0, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.current()).toEqual({ codec: 'vp9' });
  });

  it.each([
    [
      'fails',
      () => Promise.reject(new Error('probe crashed')),
      'warn: video probe failed: Error: probe crashed',
    ],
    ['finds no encoder', () => Promise.resolve(null), 'info: video probe: no encoder, audio only'],
  ] as const)('answers no video when the probe %s', async (_label, probeVideo, line) => {
    const { probe, logs } = setup(probeVideo);
    probe.refresh(withVideo);
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.current()).toBeNull();
    expect(logs).toContain(line);
  });

  it('lets a start wait for the first answer, and not once it came', async () => {
    const { probeVideo, answer } = heldProbe();
    const { probe } = setup(probeVideo);
    expect(probe.firstAnswer()).toBeNull();
    probe.refresh(withVideo);
    const waited = probe.firstAnswer();
    answer(0, { codec: 'vp9' });
    await waited;
    expect(probe.current()).toEqual({ codec: 'vp9' });
    expect(probe.firstAnswer()).toBeNull();
  });

  it('gives up waiting after 2 s: no video, and no wait for the next start', async () => {
    const { probeVideo, answer } = heldProbe();
    const { probe } = setup(probeVideo);
    probe.refresh(withVideo);
    const waited = probe.firstAnswer();
    await vi.advanceTimersByTimeAsync(2_000);
    await waited;
    expect(probe.current()).toBeNull();
    expect(probe.firstAnswer()).toBeNull();
    // An answer that comes later is kept for the next recording.
    answer(0, { codec: 'vp9' });
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.current()).toEqual({ codec: 'vp9' });
  });

  // Without WebCodecs (resistFingerprinting, an insecure page) there is nothing to encode with.
  it('answers no video without WebCodecs in the page', async () => {
    const { probe, logs } = setup(undefined, {});
    probe.refresh(withVideo);
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.current()).toBeNull();
    expect(logs).toEqual(['info: video probe: no encoder, audio only']);
  });

  it("asks the page's encoders through Mediabunny's test encodes when WebCodecs is there", async () => {
    registerFakeMediabunnyEncoders();
    const { probe, logs } = setup(undefined, { VideoEncoder: {}, AudioEncoder: {} });
    probe.refresh(withVideo);
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    expect(logs[0]).toMatch(/^info: video probe: /);
  });
});
