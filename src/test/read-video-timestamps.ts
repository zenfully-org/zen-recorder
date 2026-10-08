import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';

/** The timestamps (s) of the video packets of a WebM file, in file order. */
export async function readVideoTimestamps(file: Blob): Promise<number[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('no video track');
    const stamps: number[] = [];
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
      metadataOnly: true,
    })) {
      stamps.push(packet.timestamp);
    }
    return stamps;
  } finally {
    input.dispose();
  }
}
