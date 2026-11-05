import {
  AppendOnlyStreamTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

/**
 * A file as the page's WebCodecs encoder writes it, both tracks added, stopped once the tracks
 * `withSamples` names have one packet of synthetic bytes at 0 s. Mediabunny writes the segment
 * once every track has a sample, but `finalize()` writes it with the tracks that have one by then:
 * a Stop after the first frame and before the first audio sample leaves a file of video alone.
 */
export async function buildPageEncoderWebm(
  withSamples: 'video+audio' | 'video' | 'audio',
): Promise<Blob> {
  const bytes: Uint8Array<ArrayBuffer>[] = [];
  const output = new Output({
    format: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 3 }),
    target: new AppendOnlyStreamTarget(
      new WritableStream<Uint8Array>({ write: (chunk) => void bytes.push(chunk.slice()) }),
    ),
  });
  const video = new EncodedVideoPacketSource('vp9');
  const audio = new EncodedAudioPacketSource('opus');
  output.addVideoTrack(video, { frameRate: 15 });
  output.addAudioTrack(audio);
  await output.start();
  if (withSamples !== 'audio') {
    await video.add(new EncodedPacket(new Uint8Array(64), 'key', 0, 1 / 15), {
      decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 320, codedHeight: 180 },
    });
  }
  if (withSamples !== 'video') {
    await audio.add(new EncodedPacket(new Uint8Array(64), 'key', 0, 0.02), {
      decoderConfig: { codec: 'opus', numberOfChannels: 1, sampleRate: 48_000 },
    });
  }
  await output.finalize();
  return new Blob(bytes, { type: 'video/webm;codecs=vp9,opus' });
}
