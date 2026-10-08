/**
 * Canvas double for compositor/encoder tests: a real happy-dom <canvas> (so libraries can check
 * `instanceof HTMLCanvasElement`) whose 2D context records every drawing call instead of painting.
 */
import type { Canvas2d } from '@/lib/video/draw-composite-frame';

export interface RecordedOp {
  op: 'fillRect' | 'drawImage' | 'fillText';
  args: unknown[];
  fillStyle: string;
}

export interface FakeCanvas {
  canvas: HTMLCanvasElement;
  ctx: Canvas2d & { ops: RecordedOp[] };
  /** When true, getContext('2d') returns null (unsupported canvas). */
  contextUnavailable: boolean;
}

export function createFakeCanvas(): FakeCanvas {
  const ops: RecordedOp[] = [];
  const ctx: Canvas2d & { ops: RecordedOp[] } = {
    ops,
    fillStyle: '#000',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    fillRect(...args: unknown[]) {
      ops.push({ op: 'fillRect', args, fillStyle: String(ctx.fillStyle) });
    },
    drawImage(...args: unknown[]) {
      ops.push({ op: 'drawImage', args, fillStyle: String(ctx.fillStyle) });
    },
    fillText(...args: unknown[]) {
      ops.push({ op: 'fillText', args, fillStyle: String(ctx.fillStyle) });
    },
    measureText(text: string) {
      return { width: text.length * 8 };
    },
  };
  const canvas = document.createElement('canvas');
  const fake: FakeCanvas = { contextUnavailable: false, ctx, canvas };
  Object.defineProperty(canvas, 'getContext', {
    value: (kind: string) => (kind === '2d' && !fake.contextUnavailable ? ctx : null),
    configurable: true,
  });
  return fake;
}
