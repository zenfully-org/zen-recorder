import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_FORMATS, BlobSource, Conversion, Input } from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import { buildHeaderOnlyWebm } from '@/test/build-header-only-webm';
import { createFakeOpfsStorage } from '@/test/fakes/create-fake-opfs-storage';
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

describe('remuxWebm', () => {
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
