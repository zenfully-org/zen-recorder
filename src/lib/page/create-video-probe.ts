/**
 * Whether the page can encode the video the settings ask for: WebCodecs is asked once per
 * configuration (`probeVideoEncoder`, a real test encode), and only the newest answer is kept. A
 * recording that starts while the first answer is still on its way waits for it, briefly, rather
 * than recording the whole meeting audio only; past the wait it records without video.
 */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { probeVideoEncoder } from '@/lib/page/probe-video-encoder';
import type { PageConfig } from '@/lib/types';
import { pickVideoPlan, type VideoProbe } from '@/lib/video/pick-video-plan';

/** How long a start may wait for the first answer before it records audio only. */
const FIRST_ANSWER_WAIT_MS = 2_000;

/** Asks whether video of this size and bitrate can be encoded; null when it cannot. */
export type ProbeVideo = (input: {
  width: number;
  height: number;
  bitsPerSecond: number;
}) => Promise<VideoProbe | null>;

export interface VideoProbeDeps {
  win: {
    VideoEncoder?: unknown;
    AudioEncoder?: unknown;
    setTimeout(handler: () => void, ms: number): unknown;
    performance: { now(): number };
  };
  /** The test encode; the page's WebCodecs through Mediabunny by default. */
  probeVideo?: ProbeVideo | undefined;
  log(level: 'info' | 'warn', message: string): void;
}

export interface VideoProbeCache {
  /** Asks again for the video `config` wants; nothing when it wants none. */
  refresh(config: PageConfig): void;
  /** The newest answer; null when there is none yet, or no encoder. */
  current(): VideoProbe | null;
  /**
   * While the first answer is on its way: resolves once it came or the wait ran out, after which
   * `current()` holds it or null. Null when nothing is on its way.
   */
  firstAnswer(): Promise<void> | null;
}

export function createVideoProbe(deps: VideoProbeDeps): VideoProbeCache {
  const { win } = deps;
  // WebCodecs is absent under resistFingerprinting or on insecure pages: the probe then gives null.
  const probeVideo: ProbeVideo =
    deps.probeVideo ??
    ((input) =>
      probeVideoEncoder({
        hasWebCodecs:
          typeof win.VideoEncoder !== 'undefined' && typeof win.AudioEncoder !== 'undefined',
        canEncodeVideo: (codec, options) => canEncodeVideo(codec, options),
        canEncodeAudio: (codec, options) => canEncodeAudio(codec, options),
        ...input,
      }));
  /** undefined = the first probe has not answered yet. */
  let answer: VideoProbe | null | undefined;
  let pending: Promise<void> | null = null;
  let request = 0;

  return {
    refresh(config) {
      const wanted = pickVideoPlan({ config, probe: { codec: 'vp9' } });
      if (!wanted) return;
      const asked = ++request;
      const started = win.performance.now();
      pending = probeVideo({
        width: wanted.width,
        height: wanted.height,
        bitsPerSecond: wanted.bitsPerSecond,
      })
        .catch((error: unknown) => {
          deps.log('warn', `video probe failed: ${String(error)}`);
          return null;
        })
        .then((probe) => {
          if (asked !== request) return;
          answer = probe;
          const took = Math.round(win.performance.now() - started);
          deps.log(
            'info',
            probe
              ? `video probe: ${probe.codec} (${took} ms)`
              : 'video probe: no encoder, audio only',
          );
        });
    },
    current: () => answer ?? null,
    firstAnswer() {
      if (answer !== undefined || !pending) return null;
      const timeout = new Promise<void>((resolve) => win.setTimeout(resolve, FIRST_ANSWER_WAIT_MS));
      return Promise.race([pending, timeout]).then(() => {
        answer ??= null;
      });
    },
  };
}
