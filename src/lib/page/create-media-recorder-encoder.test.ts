import { describe, expect, it, vi } from 'vitest';
import { createFakeMediaRecorder } from '@/test/fakes/create-fake-media-recorder';
import { createMediaRecorderEncoder, type EncodedChunk } from './create-media-recorder-encoder';

function setup(factoryOptions: Parameters<typeof createFakeMediaRecorder>[0] = {}) {
  const factory = createFakeMediaRecorder(factoryOptions);
  const chunks: EncodedChunk[] = [];
  const errors: Error[] = [];
  let time = 1000;
  /** The mixer's audio graph, in seconds: the file's clock on this path. */
  let graph = 40;
  const encoder = createMediaRecorderEncoder({
    MediaRecorder: factory.Ctor,
    now: () => time,
    audioClock: () => graph,
    onChunk: (c) => chunks.push(c),
    onError: (e) => errors.push(e),
  });
  const options = { audioBitsPerSecond: 64_000, timesliceMs: 3000 };
  return {
    factory,
    chunks,
    errors,
    encoder,
    options,
    tick: (ms: number) => (time += ms),
    render: (seconds: number) => (graph += seconds),
  };
}

describe('createMediaRecorderEncoder', () => {
  it('starts a recorder with the preferred mime type, bitrate and timeslice', () => {
    const { factory, encoder, options } = setup();
    expect(encoder.state()).toBe('inactive');
    expect(encoder.mimeType()).toBe('audio/webm;codecs=opus');
    encoder.start(new MediaStream(), options);
    const instance = factory.instances[0];
    expect(instance?.options).toEqual({
      audioBitsPerSecond: 64_000,
      mimeType: 'audio/webm;codecs=opus',
    });
    expect(instance?.timeslice).toBe(3000);
    expect(encoder.state()).toBe('recording');
  });

  it('omits mimeType when nothing is supported and reports what the recorder chose', () => {
    const { factory, encoder, options } = setup({ supported: [], reportedMimeType: 'audio/ogg' });
    encoder.start(new MediaStream(), options);
    expect(factory.instances[0]?.options).toEqual({ audioBitsPerSecond: 64_000 });
    expect(encoder.mimeType()).toBe('audio/ogg');
  });

  it('refuses to start twice', () => {
    const { encoder, options } = setup();
    encoder.start(new MediaStream(), options);
    expect(() => encoder.start(new MediaStream(), options)).toThrow('already started');
  });

  it('numbers non-empty chunks and stamps them relative to start', () => {
    const { factory, chunks, encoder, options, tick } = setup();
    encoder.start(new MediaStream(), options);
    const instance = factory.instances[0];
    if (!instance) throw new Error('no instance');
    tick(3000);
    instance.emitData(10);
    instance.emitData(0);
    tick(3000);
    instance.emitData(20);
    expect(chunks.map((c) => [c.seq, c.blob.size, c.timestampMs])).toEqual([
      [0, 10, 3000],
      [1, 20, 6000],
    ]);
  });

  it('forwards errors, wrapping non-Error values', () => {
    const { factory, errors, encoder, options } = setup();
    encoder.start(new MediaStream(), options);
    const instance = factory.instances[0];
    instance?.emitError(new Error('disk full'));
    instance?.emitError('weird');
    instance?.emitError();
    expect(errors.map((e) => e.message)).toEqual(['disk full', 'weird', 'MediaRecorder error']);
  });

  it('pauses, resumes and flushes only in the matching states', () => {
    const { factory, encoder, options } = setup();
    encoder.pause();
    encoder.resume();
    encoder.flush();
    encoder.start(new MediaStream(), options);
    const instance = factory.instances[0];
    if (!instance) throw new Error('no instance');
    encoder.resume();
    encoder.flush();
    expect(instance.requestDataCalls).toBe(1);
    encoder.pause();
    expect(encoder.state()).toBe('paused');
    encoder.flush();
    expect(instance.requestDataCalls).toBe(1);
    encoder.pause();
    encoder.resume();
    expect(encoder.state()).toBe('recording');
  });

  it('stop resolves after the final chunk and is idempotent', async () => {
    const { chunks, encoder, options } = setup();
    await expect(encoder.stop()).resolves.toBeUndefined();
    encoder.start(new MediaStream(), options);
    const first = encoder.stop();
    const second = encoder.stop();
    expect(second).toBe(first);
    await first;
    expect(encoder.state()).toBe('inactive');
    expect(chunks).toHaveLength(0);
  });

  it('stop resolves immediately when the recorder is already inactive', async () => {
    const { factory, encoder, options } = setup();
    encoder.start(new MediaStream(), options);
    const instance = factory.instances[0];
    if (!instance) throw new Error('no instance');
    instance.state = 'inactive';
    const stop = vi.spyOn(instance, 'stop');
    await encoder.stop();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('createMediaRecorderEncoder, the position in the file', () => {
  it('follows the audio graph, stands still while paused and stays where it was at stop', async () => {
    const { encoder, options, tick, render } = setup();
    expect(encoder.mediaTimeMs()).toBe(0);
    encoder.start(new MediaStream(), options);
    render(1.5);
    tick(9000); // the wall clock does not count
    expect(encoder.mediaTimeMs()).toBe(1500);
    encoder.pause();
    render(2);
    expect(encoder.mediaTimeMs()).toBe(1500);
    encoder.resume();
    render(0.5);
    expect(encoder.mediaTimeMs()).toBe(2000);
    await encoder.stop();
    render(3);
    expect(encoder.mediaTimeMs()).toBe(2000);
  });

  it('does not count a pause the recorder refused', () => {
    const { encoder, options, render } = setup();
    encoder.pause();
    encoder.start(new MediaStream(), options);
    render(1);
    encoder.resume();
    render(1);
    expect(encoder.mediaTimeMs()).toBe(2000);
  });
});
