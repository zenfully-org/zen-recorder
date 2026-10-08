import { describe, expect, it, vi } from 'vitest';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { installGetUserMediaHook } from './install-get-user-media-hook';

function createMediaDevices(impl: () => Promise<MediaStream>): MediaDevices {
  return { getUserMedia: impl } as unknown as MediaDevices;
}

describe('installGetUserMediaHook', () => {
  it('reports audio tracks of a successful getUserMedia call and passes the result through', async () => {
    const audio = createFakeMediaStreamTrack({ kind: 'audio' });
    const video = createFakeMediaStreamTrack({ kind: 'video' });
    const stream = new MediaStream([audio, video] as unknown as MediaStreamTrack[]);
    const original = vi.fn(async () => stream);
    const mediaDevices = createMediaDevices(original);
    const seen: MediaStreamTrack[] = [];
    installGetUserMediaHook(mediaDevices, (t) => seen.push(t));
    const result = await mediaDevices.getUserMedia({ audio: true });
    expect(result).toBe(stream);
    expect(original).toHaveBeenCalledWith({ audio: true });
    expect(seen).toEqual([audio]);
  });

  it('keeps the original `this` binding', async () => {
    const stream = new MediaStream();
    let self: unknown;
    const mediaDevices = createMediaDevices(async function (this: unknown) {
      self = this;
      return stream;
    });
    installGetUserMediaHook(mediaDevices, () => undefined);
    await mediaDevices.getUserMedia();
    expect(self).toBe(mediaDevices);
  });

  it('swallows rejections internally but still rejects the caller', async () => {
    const mediaDevices = createMediaDevices(() => Promise.reject(new Error('denied')));
    const onMic = vi.fn();
    installGetUserMediaHook(mediaDevices, onMic);
    await expect(mediaDevices.getUserMedia()).rejects.toThrow('denied');
    expect(onMic).not.toHaveBeenCalled();
  });

  it('restores the original on uninstall unless something else replaced it', () => {
    const original = vi.fn(async () => new MediaStream());
    const mediaDevices = createMediaDevices(original);
    const handle = installGetUserMediaHook(mediaDevices, () => undefined);
    expect(mediaDevices.getUserMedia).not.toBe(original);
    handle.uninstall();
    expect(mediaDevices.getUserMedia).toBe(original);

    const handle2 = installGetUserMediaHook(mediaDevices, () => undefined);
    const other = vi.fn(async () => new MediaStream());
    mediaDevices.getUserMedia = other;
    handle2.uninstall();
    expect(mediaDevices.getUserMedia).toBe(other);
  });
});
