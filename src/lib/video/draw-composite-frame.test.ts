import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { createFakeCanvas } from '@/test/fakes/create-fake-canvas';
import { drawCompositeFrame } from './draw-composite-frame';
import type { LayoutCell } from './layout-tiles';

const video = {} as HTMLVideoElement;

function cell(
  partial: Partial<Omit<LayoutCell, 'tile'>> & { tile?: Partial<VideoTile> } = {},
): LayoutCell {
  const tile: VideoTile = {
    id: 'p1',
    source: video,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    name: 'Ana Silva',
    isSelf: false,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey: 0,
    ...partial.tile,
  };
  return { sx: 0, sy: 0, sw: 640, sh: 360, dx: 100, dy: 50, dw: 800, dh: 450, ...partial, tile };
}

const options = { width: 1920, height: 1080, labels: true };

describe('drawCompositeFrame', () => {
  it('draws the placeholder for a participant without any video element', () => {
    const fake = createFakeCanvas();
    drawCompositeFrame(fake.ctx, [cell({ tile: { source: null, name: 'Ana Silva' } })], options);
    expect(fake.ctx.ops.some((op) => op.op === 'drawImage')).toBe(false);
    expect(fake.ctx.ops.some((op) => op.op === 'fillText' && op.args[0] === 'AS')).toBe(true);
  });

  it('fills the background first and draws each tile with its rects', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell()], { ...options, labels: false });
    expect(ctx.ops.map((o) => o.op)).toEqual(['fillRect', 'drawImage']);
    expect(ctx.ops[0]).toMatchObject({ args: [0, 0, 1920, 1080], fillStyle: '#202124' });
    expect(ctx.ops[1]?.args).toEqual([video, 0, 0, 640, 360, 100, 50, 800, 450]);
  });

  it('adds a name label pill under the video when labels are on', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell()], options);
    expect(ctx.ops.map((o) => o.op)).toEqual(['fillRect', 'drawImage', 'fillRect', 'fillText']);
    expect(ctx.ops[2]?.fillStyle).toBe('rgba(0, 0, 0, 0.6)');
    expect(ctx.ops[3]).toMatchObject({
      args: ['Ana Silva', expect.any(Number), expect.any(Number)],
    });
    // the pill sits inside the tile's box
    const [x = 0, y = 0, w = 0, h = 0] = (ctx.ops[2]?.args ?? []) as number[];
    expect(x).toBeGreaterThanOrEqual(100);
    expect(y + h).toBeLessThanOrEqual(500);
    expect(x + w).toBeLessThanOrEqual(900);
  });

  it('skips the label for unnamed or tiny tiles', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell({ tile: { name: null } }), cell({ dh: 40 })], options);
    expect(ctx.ops.filter((o) => o.op === 'fillText')).toEqual([]);
  });

  it('draws an initials placeholder for tiles without frames', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell({ sw: 0, sh: 0 })], { ...options, labels: false });
    expect(ctx.ops.map((o) => o.op)).toEqual(['fillRect', 'fillRect', 'fillText']);
    expect(ctx.ops[1]).toMatchObject({ args: [100, 50, 800, 450], fillStyle: '#3c4043' });
    expect(ctx.ops[2]?.args).toEqual(['AS', 500, 275]);
  });

  it.each([
    ['a single name', 'Madonna', 'M'],
    ['no name', null, '?'],
    ['a blank name', '   ', '?'],
    ['a three-part name', 'Ana de Souza', 'AS'],
  ])('derives initials from %s', (_label, name, expected) => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell({ sw: 0, sh: 0, tile: { name } })], {
      ...options,
      labels: false,
    });
    expect(ctx.ops.at(-1)?.args[0]).toBe(expected);
  });

  it('omits the initials when the placeholder is too small', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [cell({ sw: 0, sh: 0, dh: 30 })], { ...options, labels: false });
    expect(ctx.ops.map((o) => o.op)).toEqual(['fillRect', 'fillRect']);
  });

  it('draws a tile from the snapshot taken of its source for this frame', () => {
    const { ctx } = createFakeCanvas();
    const shared = document.createElement('canvas');
    const snapshot = document.createElement('canvas');
    drawCompositeFrame(ctx, [cell({ tile: { source: shared } }), cell({ tile: { id: 'p2' } })], {
      ...options,
      labels: false,
      images: new Map([[shared, snapshot]]),
    });
    const [first, second] = ctx.ops.filter((o) => o.op === 'drawImage').map((o) => o.args[0]);
    expect(first).toBe(snapshot);
    expect(second).toBe(video);
  });

  it('shows a notice when there are no tiles', () => {
    const { ctx } = createFakeCanvas();
    drawCompositeFrame(ctx, [], options);
    expect(ctx.ops.map((o) => o.op)).toEqual(['fillRect', 'fillText']);
    expect(ctx.ops[1]?.args).toEqual(['No video tiles', 960, 540]);
  });
});
