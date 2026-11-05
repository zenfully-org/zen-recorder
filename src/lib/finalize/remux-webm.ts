/**
 * MediaRecorder/append-only output has no Duration/SeekHead/Cues, so players show an infinite
 * duration and cannot seek. Remuxing through Mediabunny (no re-encode) writes a proper, seekable
 * WebM. Large files are streamed into an OPFS scratch file instead of one giant ArrayBuffer.
 *
 * A file in which no track has a packet is reported as `empty` instead: nothing was recorded, and
 * no player can open what is there. Otherwise the result says which tracks have one (`media`): a
 * recording with video can hold one track, and the meeting notes say what the file holds.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  Output,
  StreamTarget,
  type Target,
  WebMOutputFormat,
} from 'mediabunny';
import type { OpfsScratchFile } from '@/lib/finalize/create-opfs-scratch-file';
import type { FinalizeStrategy } from '@/lib/finalize/pick-finalize-strategy';
import { remuxStartOffsetMs } from '@/lib/finalize/remux-start-offset-ms';
import type { FileMedia } from '@/lib/types';

export interface RemuxResult {
  blob: Blob;
  /** The input's end timestamp: the file's length plus `startOffsetMs`. */
  durationMs: number | null;
  /**
   * How far the remux moved every timestamp back (the first packet's time, never below 0): a
   * position on the recording's own clock is this much earlier in the saved file. 0 when the file
   * is saved as it came.
   */
  startOffsetMs: number;
  remuxed: boolean;
  /**
   * The tracks with a packet in the input, which the saved file holds whether it was remuxed or
   * saved as it came. Absent when the input could not be read, and when it is `empty`.
   */
  media?: FileMedia;
  /** No track has a packet: the recording stopped before its first sample. Nothing to save. */
  empty?: boolean;
  error?: string;
  /** Releases scratch storage once the file has been saved (streamed remuxes only). */
  cleanup?: () => Promise<void>;
}

export interface RemuxDeps {
  strategy?: FinalizeStrategy;
  /** Required for the 'stream' strategy. */
  openScratch?: () => Promise<OpfsScratchFile>;
}

/**
 * The tracks with a packet, or null when none has one: nothing was recorded. A page encoder
 * stopped before its first frame or audio sample leaves a header with no track at all, and a
 * header can also declare a track without a packet.
 */
async function mediaOf(input: Input): Promise<FileMedia | null> {
  const tracks = await input.getTracks();
  const firsts = await Promise.all(
    tracks.map((track) => new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true })),
  );
  const sampled = tracks.filter((_track, index) => firsts[index] != null);
  const video = sampled.some((track) => track.isVideoTrack());
  const audio = sampled.some((track) => track.isAudioTrack());
  if (video) return audio ? 'video+audio' : 'video';
  return audio ? 'audio' : null;
}

async function durationOf(input: Input): Promise<number | null> {
  const seconds = await input.computeDuration();
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

async function convert(input: Input, target: Target): Promise<void> {
  const output = new Output({ format: new WebMOutputFormat(), target });
  const conversion = await Conversion.init({ input, output });
  if (!conversion.isValid) throw new Error('conversion invalid: no usable tracks');
  await conversion.execute();
}

/**
 * Returns the remuxed file, or the original blob (with `remuxed: false`) if anything fails or the
 * file is empty.
 */
export async function remuxWebm(
  source: Blob,
  mimeType: string,
  deps: RemuxDeps = {},
): Promise<RemuxResult> {
  const type = mimeType || 'audio/webm';
  const strategy = deps.strategy ?? 'buffer';
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  let scratch: OpfsScratchFile | null = null;
  let media: FileMedia | null = null;
  try {
    media = await mediaOf(input);
    if (media === null) {
      return {
        blob: source,
        durationMs: null,
        startOffsetMs: 0,
        remuxed: false,
        empty: true,
        error: 'no audio or video packets',
      };
    }
    const durationMs = await durationOf(input);
    if (strategy === 'raw') {
      const error = 'too large to remux in memory';
      return { blob: source, durationMs, startOffsetMs: 0, remuxed: false, media, error };
    }
    // Read from the input the conversion reads, before it runs.
    const startOffsetMs = remuxStartOffsetMs(await input.getFirstTimestamp());
    if (strategy === 'stream') {
      if (!deps.openScratch) throw new Error('streaming remux needs scratch storage');
      const opened = await deps.openScratch();
      scratch = opened;
      await convert(input, new StreamTarget(opened.writable, { chunked: true }));
      const file = await opened.file();
      return {
        blob: file.slice(0, file.size, type),
        durationMs,
        startOffsetMs,
        remuxed: true,
        media,
        cleanup: () => opened.discard(),
      };
    }
    const target = new BufferTarget();
    await convert(input, target);
    if (!target.buffer) throw new Error('remux produced no data');
    const blob = new Blob([target.buffer], { type });
    return { blob, durationMs, startOffsetMs, remuxed: true, media };
  } catch (error) {
    await scratch?.discard();
    return {
      blob: source,
      durationMs: null,
      startOffsetMs: 0,
      remuxed: false,
      ...(media === null ? {} : { media }),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    input.dispose();
  }
}
