/**
 * Asks once whether VP9 (else VP8) plus Opus can really be encoded at the requested size. On
 * Firefox `isConfigSupported` is unreliable, so this goes through Mediabunny's `canEncode*`, which
 * performs a real test encode. The test encode uses the recording's `latencyMode: 'realtime'`:
 * without it Firefox sets libvpx up for 'quality' (several threads, lookahead), which is slower
 * and not what the recording uses. Results are memoised per configuration.
 */
import type { VideoProbe } from '@/lib/video/pick-video-plan';

export interface ProbeVideoEncoderDeps {
  /** `VideoEncoder` and `AudioEncoder` exist (absent under resistFingerprinting / insecure pages). */
  hasWebCodecs: boolean;
  canEncodeVideo: (
    codec: VideoProbe['codec'],
    options: { width: number; height: number; bitrate: number; latencyMode: 'realtime' },
  ) => Promise<boolean>;
  canEncodeAudio: (
    codec: 'opus',
    options: { numberOfChannels: number; sampleRate: number },
  ) => Promise<boolean>;
  width: number;
  height: number;
  bitsPerSecond: number;
}

const CODECS: VideoProbe['codec'][] = ['vp9', 'vp8'];

const cache = new WeakMap<
  ProbeVideoEncoderDeps['canEncodeVideo'],
  Map<string, Promise<VideoProbe | null>>
>();

async function probe(deps: ProbeVideoEncoderDeps): Promise<VideoProbe | null> {
  const attempt = async (check: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await check();
    } catch {
      return false;
    }
  };
  const opus = await attempt(() =>
    deps.canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: 48_000 }),
  );
  if (!opus) return null;
  for (const codec of CODECS) {
    const ok = await attempt(() =>
      deps.canEncodeVideo(codec, {
        width: deps.width,
        height: deps.height,
        bitrate: deps.bitsPerSecond,
        latencyMode: 'realtime',
      }),
    );
    if (ok) return { codec };
  }
  return null;
}

export function probeVideoEncoder(deps: ProbeVideoEncoderDeps): Promise<VideoProbe | null> {
  if (!deps.hasWebCodecs) return Promise.resolve(null);
  let byConfig = cache.get(deps.canEncodeVideo);
  if (!byConfig) {
    byConfig = new Map();
    cache.set(deps.canEncodeVideo, byConfig);
  }
  const key = `${deps.width}x${deps.height}@${deps.bitsPerSecond}`;
  let pending = byConfig.get(key);
  if (!pending) {
    pending = probe(deps);
    byConfig.set(key, pending);
  }
  return pending;
}
