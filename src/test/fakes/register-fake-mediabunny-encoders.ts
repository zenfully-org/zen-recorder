/**
 * Registers fake (custom) Mediabunny encoders so the REAL muxer can run under Vitest, where
 * WebCodecs does not exist. Packets are synthetic bytes; keyframes follow the encode options.
 */
import {
  type AudioCodec,
  type AudioSample,
  CustomAudioEncoder,
  CustomVideoEncoder,
  EncodedPacket,
  registerEncoder,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';

export interface FakeMediabunnyEncoders {
  videoPackets: number;
  audioPackets: number;
  keyFrames: number;
  /** When set, the next video encode throws this error. */
  failNextVideoEncode: Error | null;
  reset(): void;
}

let shared: FakeMediabunnyEncoders | null = null;

export function registerFakeMediabunnyEncoders(): FakeMediabunnyEncoders {
  if (shared) {
    shared.reset();
    return shared;
  }
  const stats: FakeMediabunnyEncoders = {
    videoPackets: 0,
    audioPackets: 0,
    keyFrames: 0,
    failNextVideoEncode: null,
    reset() {
      stats.videoPackets = 0;
      stats.audioPackets = 0;
      stats.keyFrames = 0;
      stats.failNextVideoEncode = null;
    },
  };

  class FakeVideoEncoder extends CustomVideoEncoder {
    static override supports(codec: VideoCodec): boolean {
      return codec === 'vp9' || codec === 'vp8';
    }
    init(): void {}
    encode(sample: VideoSample, options: VideoEncoderEncodeOptions): void {
      if (stats.failNextVideoEncode) {
        const error = stats.failNextVideoEncode;
        stats.failNextVideoEncode = null;
        throw error;
      }
      const key = options.keyFrame === true || stats.videoPackets === 0;
      if (key) stats.keyFrames++;
      const data = new Uint8Array(key ? 2000 : 500).fill(stats.videoPackets & 0xff);
      this.onPacket(
        new EncodedPacket(
          data,
          key ? 'key' : 'delta',
          sample.timestamp,
          sample.duration,
          stats.videoPackets,
        ),
        stats.videoPackets === 0
          ? {
              decoderConfig: {
                codec: this.codec === 'vp8' ? 'vp8' : 'vp09.00.10.08',
                codedWidth: sample.codedWidth,
                codedHeight: sample.codedHeight,
              },
            }
          : undefined,
      );
      stats.videoPackets++;
    }
    flush(): void {}
    close(): void {}
  }

  class FakeAudioEncoder extends CustomAudioEncoder {
    static override supports(codec: AudioCodec): boolean {
      return codec === 'opus';
    }
    init(): void {}
    encode(sample: AudioSample): void {
      const data = new Uint8Array(120).fill(stats.audioPackets & 0xff);
      this.onPacket(
        new EncodedPacket(data, 'key', sample.timestamp, sample.duration, stats.audioPackets),
        stats.audioPackets === 0
          ? {
              decoderConfig: {
                codec: 'opus',
                sampleRate: sample.sampleRate,
                numberOfChannels: sample.numberOfChannels,
              },
            }
          : undefined,
      );
      stats.audioPackets++;
    }
    flush(): void {}
    close(): void {}
  }

  registerEncoder(FakeVideoEncoder);
  registerEncoder(FakeAudioEncoder);
  shared = stats;
  return stats;
}
