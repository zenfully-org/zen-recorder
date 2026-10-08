/**
 * MediaRecorder/append-only output has no Duration/SeekHead/Cues, so players show an infinite
 * duration and cannot seek. Remuxing through Mediabunny (no re-encode) writes a proper, seekable
 * WebM. Large files are streamed into an OPFS scratch file instead of one giant ArrayBuffer.
 *
 * A file in which no track has a packet is reported as `empty` instead: nothing was recorded, and
 * no player can open what is there.
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

export interface RemuxResult {
  blob: Blob;
  durationMs: number | null;
  remuxed: boolean;
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
 * False when nothing was recorded. A page encoder stopped before its first frame or audio sample
 * leaves a header with no track at all, and a header can also declare a track without a packet.
 */
async function hasPackets(input: Input): Promise<boolean> {
  const tracks = await input.getTracks();
  const firsts = await Promise.all(
    tracks.map((track) => new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true })),
  );
  return firsts.some((packet) => packet !== null);
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
  try {
    if (!(await hasPackets(input))) {
      return {
        blob: source,
        durationMs: null,
        remuxed: false,
        empty: true,
        error: 'no audio or video packets',
      };
    }
    const durationMs = await durationOf(input);
    if (strategy === 'raw') {
      return { blob: source, durationMs, remuxed: false, error: 'too large to remux in memory' };
    }
    if (strategy === 'stream') {
      if (!deps.openScratch) throw new Error('streaming remux needs scratch storage');
      const opened = await deps.openScratch();
      scratch = opened;
      await convert(input, new StreamTarget(opened.writable, { chunked: true }));
      const file = await opened.file();
      return {
        blob: file.slice(0, file.size, type),
        durationMs,
        remuxed: true,
        cleanup: () => opened.discard(),
      };
    }
    const target = new BufferTarget();
    await convert(input, target);
    if (!target.buffer) throw new Error('remux produced no data');
    return { blob: new Blob([target.buffer], { type }), durationMs, remuxed: true };
  } catch (error) {
    await scratch?.discard();
    return {
      blob: source,
      durationMs: null,
      remuxed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    input.dispose();
  }
}
