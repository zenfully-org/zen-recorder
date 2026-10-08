import {
  AppendOnlyStreamTarget,
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

/**
 * What the page's WebCodecs encoder writes when it is stopped before its first frame or audio
 * sample: Mediabunny writes the segment once every track has a sample, so `finalize()`
 * without any writes the EBML header, `Info` and an empty `Tracks` element, and no `Cluster`.
 * 101 bytes, as the page sent them in the live test.
 */
export async function buildHeaderOnlyWebm(): Promise<Blob> {
  const bytes: Uint8Array<ArrayBuffer>[] = [];
  const output = new Output({
    format: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 3 }),
    target: new AppendOnlyStreamTarget(
      new WritableStream<Uint8Array>({ write: (chunk) => void bytes.push(chunk.slice()) }),
    ),
  });
  output.addVideoTrack(new EncodedVideoPacketSource('vp9'), { frameRate: 15 });
  output.addAudioTrack(new EncodedAudioPacketSource('opus'));
  await output.start();
  await output.finalize();
  return new Blob(bytes, { type: 'video/webm;codecs=vp9,opus' });
}
