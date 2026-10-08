import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ALL_FORMATS,
  AppendOnlyStreamTarget,
  BlobSource,
  Conversion,
  EncodedPacket,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import { buildHeaderOnlyWebm } from '@/test/build-header-only-webm';
import { createFakeOpfsStorage } from '@/test/fakes/create-fake-opfs-storage';
import { readVideoTimestamps } from '@/test/read-video-timestamps';
import { createOpfsScratchFile } from './create-opfs-scratch-file';
import { remuxWebm } from './remux-webm';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/mediarecorder-opus.webm');
const CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

async function fixtureBlob(): Promise<Blob> {
  return new Blob([await readFile(FIXTURE)], { type: 'audio/webm;codecs=opus' });
}

/** The fixture's header up to its first `Cluster`: an Opus track that has no packet. */
async function fixtureHeader(): Promise<Blob> {
  const bytes = await readFile(FIXTURE);
  return new Blob([bytes.subarray(0, bytes.indexOf(CLUSTER_ID))], { type: 'audio/webm' });
}

async function durationOf(blob: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

/**
 * An append-only WebM like the page's encoder writes: a VP9 track of `frameRate` (whose grid the
 * muxer rounds every timestamp to) with one packet of synthetic bytes at each of `stamps`.
 */
async function buildVideoWebm(stamps: readonly number[], frameRate: number): Promise<Blob> {
  const bytes: Uint8Array<ArrayBuffer>[] = [];
  const output = new Output({
    format: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 1 }),
    target: new AppendOnlyStreamTarget(
      new WritableStream<Uint8Array>({ write: (chunk) => void bytes.push(chunk.slice()) }),
    ),
  });
  const video = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(video, { frameRate });
  await output.start();
  for (const [index, stamp] of stamps.entries()) {
    const key = index % 15 === 0;
    const packet = new EncodedPacket(
      new Uint8Array(64),
      key ? 'key' : 'delta',
      stamp,
      1 / frameRate,
    );
    await video.add(
      packet,
      index === 0
        ? { decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 320, codedHeight: 180 } }
        : undefined,
    );
  }
  await output.finalize();
  return new Blob(bytes, { type: 'video/webm;codecs=vp9' });
}

describe('remuxWebm', () => {
  it('keeps the timestamp of every video frame, so frames on adjacent slots of a 15 fps grid stay apart', async () => {
    // Adjacent slots are 66.7 ms apart; the file stores milliseconds (0, 67, 133, 200, …).
    const slots = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23];
    const source = await buildVideoWebm(
      slots.map((slot) => slot / 15),
      15,
    );
    const result = await remuxWebm(source, 'video/webm;codecs=vp9');
    expect(result.remuxed).toBe(true);
    const before = await readVideoTimestamps(source);
    const after = await readVideoTimestamps(result.blob);
    expect(new Set(before).size).toBe(slots.length);
    expect(after).toEqual(before);
  });

  it('turns a raw MediaRecorder file into a seekable WebM with a known duration', async () => {
    const source = await fixtureBlob();
    const result = await remuxWebm(source, 'audio/webm;codecs=opus');
    expect(result.remuxed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThan(15_000);
    expect(result.durationMs).toBeLessThan(20_000);
    expect(result.blob.type).toBe('audio/webm;codecs=opus');
    expect(result.blob.size).toBeGreaterThan(source.size * 0.9);
    expect(await durationOf(result.blob)).toBeCloseTo((result.durationMs ?? 0) / 1000, 1);
  }, 30_000);

  it('streams the remux through a scratch file and cleans it up afterwards', async () => {
    const storage = createFakeOpfsStorage();
    const source = await fixtureBlob();
    const result = await remuxWebm(source, 'audio/webm;codecs=opus', {
      strategy: 'stream',
      openScratch: () => createOpfsScratchFile({ storage, name: 'scratch.webm' }),
    });
    expect(result.remuxed).toBe(true);
    expect(result.durationMs).toBeGreaterThan(15_000);
    expect(result.blob.type).toBe('audio/webm;codecs=opus');
    expect(result.blob.size).toBeGreaterThan(source.size * 0.9);
    expect(await durationOf(result.blob)).toBeCloseTo((result.durationMs ?? 0) / 1000, 1);
    expect(storage.files.has('scratch.webm')).toBe(true);
    await result.cleanup?.();
    expect(storage.files.has('scratch.webm')).toBe(false);
  }, 30_000);

  it('fails cleanly when streaming is requested without scratch storage', async () => {
    const result = await remuxWebm(await fixtureBlob(), 'audio/webm', { strategy: 'stream' });
    expect(result.remuxed).toBe(false);
    expect(result.error).toBe('streaming remux needs scratch storage');
  });

  it('discards the scratch file when a streamed remux fails', async () => {
    const storage = createFakeOpfsStorage();
    const openScratch = vi.fn(() => createOpfsScratchFile({ storage, name: 'scratch.webm' }));
    const execute = vi
      .spyOn(Conversion.prototype, 'execute')
      .mockRejectedValueOnce(new Error('disk full'));
    const result = await remuxWebm(await fixtureBlob(), 'audio/webm', {
      strategy: 'stream',
      openScratch,
    });
    execute.mockRestore();
    expect(result).toMatchObject({ remuxed: false, error: 'disk full' });
    expect(openScratch).toHaveBeenCalledTimes(1);
    expect(storage.files.has('scratch.webm')).toBe(false);
  });

  it('returns the source untouched, with its duration, for the raw strategy', async () => {
    const source = await fixtureBlob();
    const result = await remuxWebm(source, 'audio/webm', { strategy: 'raw' });
    expect(result).toMatchObject({
      blob: source,
      remuxed: false,
      error: 'too large to remux in memory',
    });
    expect(result.durationMs).toBeGreaterThan(15_000);
  });

  it('defaults the mime type when none is given', async () => {
    const result = await remuxWebm(await fixtureBlob(), '');
    expect(result.blob.type).toBe('audio/webm');
  }, 30_000);

  it('falls back to the original blob when the input is not media', async () => {
    const source = new Blob(['definitely not a webm file']);
    const result = await remuxWebm(source, 'audio/webm');
    expect(result.remuxed).toBe(false);
    expect(result.blob).toBe(source);
    expect(result.durationMs).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.empty).toBeUndefined();
  });

  // The page's encoder stopped before its first frame or audio sample.
  it.each([
    { name: 'no track at all (the 101-byte header-only file)', build: buildHeaderOnlyWebm },
    { name: 'a track without a single packet', build: fixtureHeader },
  ])('reports a file with $name as empty: nothing was recorded', async ({ build }) => {
    const source = await build();
    const storage = createFakeOpfsStorage();
    const result = await remuxWebm(source, 'video/webm', {
      strategy: 'stream',
      openScratch: () => createOpfsScratchFile({ storage, name: 'scratch.webm' }),
    });
    expect(result).toEqual({
      blob: source,
      durationMs: null,
      remuxed: false,
      empty: true,
      error: 'no audio or video packets',
    });
    expect(storage.files.size).toBe(0);
  });

  it('fails cleanly when the conversion has no usable tracks or produces no data', async () => {
    const source = await fixtureBlob();
    const init = vi.spyOn(Conversion, 'init');
    init.mockResolvedValueOnce({ isValid: false } as unknown as Conversion);
    expect((await remuxWebm(source, 'audio/webm')).error).toBe(
      'conversion invalid: no usable tracks',
    );
    init.mockResolvedValueOnce({
      isValid: true,
      execute: async () => undefined,
    } as unknown as Conversion);
    expect((await remuxWebm(source, 'audio/webm')).error).toBe('remux produced no data');
    init.mockRestore();
  });

  it('reports an unknown duration when the input cannot compute one', async () => {
    const source = await fixtureBlob();
    const spy = vi.spyOn(Input.prototype, 'computeDuration').mockResolvedValueOnce(Infinity);
    const result = await remuxWebm(source, 'audio/webm');
    expect(result.remuxed).toBe(true);
    expect(result.durationMs).toBeNull();
    spy.mockRestore();
  }, 30_000);

  it('reports non-Error failures as strings', async () => {
    const source = await fixtureBlob();
    const spy = vi.spyOn(Input.prototype, 'computeDuration').mockRejectedValueOnce('boom');
    const result = await remuxWebm(source, 'audio/webm');
    expect(result).toMatchObject({ remuxed: false, error: 'boom' });
    spy.mockRestore();
  });
});
