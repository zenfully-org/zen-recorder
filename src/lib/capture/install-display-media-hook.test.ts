import { describe, expect, it, vi } from 'vitest';
import { installDisplayMediaHook } from './install-display-media-hook';

/** A track as a stream hands it out: what the hook reads of it is all it has. */
const track = (kind: 'audio' | 'video') => ({ kind, readyState: 'live' });
type Track = ReturnType<typeof track>;

/** A stream of `tracks`, as `getDisplayMedia` resolves with one. */
const stream = (...tracks: Track[]) => ({
  getVideoTracks: () => tracks.filter((one) => one.kind === 'video'),
});

function setup(answer: (options?: object) => Promise<ReturnType<typeof stream>>) {
  const getDisplayMedia = vi.fn(answer);
  const mediaDevices = { getDisplayMedia };
  const seen: Track[] = [];
  const hook = installDisplayMediaHook(mediaDevices, (shared) => seen.push(shared));
  return { getDisplayMedia, mediaDevices, seen, hook };
}

describe('installDisplayMediaHook', () => {
  it("reports the screen a share started with, once the browser gave it, and hands the page the browser's answer", async () => {
    const screen = track('video');
    const shared = stream(screen, track('audio'));
    const { getDisplayMedia, mediaDevices, seen } = setup(async () => shared);
    const answer = mediaDevices.getDisplayMedia({ video: true });
    expect(seen).toEqual([]);
    await expect(answer).resolves.toBe(shared);
    expect(seen).toEqual([screen]);
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true });
  });

  it('calls the browser on the object the page called it on', async () => {
    let self: unknown;
    const mediaDevices = {
      async getDisplayMedia(this: unknown) {
        self = this;
        return stream();
      },
    };
    installDisplayMediaHook(mediaDevices, () => undefined);
    await mediaDevices.getDisplayMedia();
    expect(self).toBe(mediaDevices);
  });

  it('reports nothing of a share the browser refused, and the page still sees the refusal', async () => {
    const { mediaDevices, seen } = setup(() => Promise.reject(new Error('NotAllowedError')));
    await expect(mediaDevices.getDisplayMedia()).rejects.toThrow('NotAllowedError');
    expect(seen).toEqual([]);
  });

  // A page that checks the function it calls finds the browser's, as far as it can look.
  it('looks like the function it wraps', () => {
    const { getDisplayMedia, mediaDevices } = setup(async () => stream());
    expect(mediaDevices.getDisplayMedia).not.toBe(getDisplayMedia);
    expect(mediaDevices.getDisplayMedia.name).toBe(getDisplayMedia.name);
    expect(mediaDevices.getDisplayMedia).toHaveLength(getDisplayMedia.length);
    expect(mediaDevices.getDisplayMedia).toBeInstanceOf(Function);
    expect(Function.prototype.toString.call(mediaDevices.getDisplayMedia)).toContain('native code');
  });

  it('puts the original back on uninstall, unless the page replaced it meanwhile', () => {
    const { getDisplayMedia, mediaDevices, hook } = setup(async () => stream());
    hook?.uninstall();
    expect(mediaDevices.getDisplayMedia).toBe(getDisplayMedia);

    const again = installDisplayMediaHook(mediaDevices, () => undefined);
    const replaced = vi.fn(async () => stream());
    mediaDevices.getDisplayMedia = replaced;
    again?.uninstall();
    expect(mediaDevices.getDisplayMedia).toBe(replaced);
  });

  it('installs nothing where the page cannot share a screen', () => {
    expect(installDisplayMediaHook({}, () => undefined)).toBeNull();
    expect(installDisplayMediaHook(undefined, () => undefined)).toBeNull();
  });
});
