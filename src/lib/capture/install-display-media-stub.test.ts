import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCanvas } from '@/test/fakes/create-fake-canvas';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { type DisplayMediaStubDeps, installDisplayMediaStub } from './install-display-media-stub';

function setup() {
  const fake = createFakeCanvas();
  const track = createFakeMediaStreamTrack({ kind: 'video', label: 'Screen' });
  const captureStream = vi.fn((_fps: number) => new MediaStream([track]));
  Object.defineProperty(fake.canvas, 'captureStream', { value: captureStream });
  const userActivation = { isActive: true };
  const mediaDevices: DisplayMediaStubDeps['mediaDevices'] = {};
  const deps: DisplayMediaStubDeps = {
    mediaDevices,
    userActivation,
    createCanvas: () => fake.canvas,
    setInterval: (handler, ms) => Number(setInterval(handler, ms)),
    clearInterval: (id) => clearInterval(id),
  };
  installDisplayMediaStub(deps);
  const share = async () => {
    const stream = await mediaDevices.getDisplayMedia?.({ video: true });
    if (!stream) throw new Error('the stub was not installed');
    return stream;
  };
  return { fake, track, captureStream, userActivation, share };
}

describe('installDisplayMediaStub', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shares a moving picture the page draws, at the size of a small screen', async () => {
    const { fake, track, captureStream, share } = setup();
    const stream = await share();
    expect(stream.getVideoTracks()).toEqual([track]);
    expect([fake.canvas.width, fake.canvas.height]).toEqual([640, 360]);
    expect(captureStream).toHaveBeenCalledWith(10);
    const painted = fake.ctx.ops.length;
    expect(painted).toBeGreaterThan(0);
    vi.advanceTimersByTime(300);
    expect(fake.ctx.ops.length).toBeGreaterThan(painted);
    const moved = fake.ctx.ops.filter((op) => op.op === 'fillRect').map((op) => op.args[0]);
    expect(new Set(moved).size).toBeGreaterThan(1);
  });

  it('stops drawing once the share is stopped', async () => {
    const { fake, track, share } = setup();
    await share();
    track.stop();
    vi.advanceTimersByTime(100);
    const painted = fake.ctx.ops.length;
    vi.advanceTimersByTime(1_000);
    expect(fake.ctx.ops).toHaveLength(painted);
  });

  it('refuses a share no click started, as Firefox does', async () => {
    const { userActivation, captureStream, share } = setup();
    userActivation.isActive = false;
    await expect(share()).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(captureStream).not.toHaveBeenCalled();
  });

  it('refuses a share it cannot draw', async () => {
    const { fake, share } = setup();
    fake.contextUnavailable = true;
    await expect(share()).rejects.toMatchObject({ name: 'NotSupportedError' });
  });
});
