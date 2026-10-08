import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayDrag } from './create-overlay-drag';

function setup() {
  const surface = document.createElement('div');
  const button = document.createElement('button');
  surface.append(button);
  document.body.append(surface);
  const events: string[] = [];
  const clicks = vi.fn();
  button.addEventListener('click', clicks);
  createOverlayDrag(surface, {
    onStart: () => events.push('start'),
    onMove: (dx, dy) => events.push(`move ${dx},${dy}`),
    onEnd: () => events.push('end'),
  });
  const pointer = (
    type: string,
    x: number,
    y: number,
    init: PointerEventInit = {},
    target: Element = button,
  ) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
        ...init,
      }),
    );
  /** A mouse click as the browser fires it after a press and a release (`detail` counts clicks). */
  const click = (detail = 1) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  return { surface, button, events, clicks, pointer, click };
}

describe('createOverlayDrag', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('takes a press and a release without movement for a click', () => {
    const { events, clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 100, 100);
    click();
    expect(events).toEqual([]);
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('takes a shaky click that moves less than the threshold for a click', () => {
    const { events, clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 103, 102);
    pointer('pointerup', 103, 102);
    click();
    expect(events).toEqual([]);
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('captures the pointer on the pressed element, so the card follows it anywhere', () => {
    const { button, pointer } = setup();
    pointer('pointerdown', 100, 100);
    expect(button.hasPointerCapture(1)).toBe(true);
  });

  it('starts a drag past the threshold, reports moves from the press, and ends on release', () => {
    const { events, pointer } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 104, 100);
    pointer('pointermove', 90, 130);
    pointer('pointermove', 60, 150);
    pointer('pointerup', 60, 150);
    expect(events).toEqual(['start', 'move -10,30', 'move -40,50', 'end']);
  });

  it('swallows the click that ends a drag, so dragging never presses a button', () => {
    const { clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointerup', 140, 100);
    expect(click()).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
    pointer('pointerdown', 140, 100);
    pointer('pointerup', 140, 100);
    click();
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('forgets the swallowed click at the next press when the browser fired none', () => {
    const { clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointerup', 140, 100);
    pointer('pointerdown', 140, 100);
    pointer('pointerup', 140, 100);
    click();
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('leaves a keyboard click alone after a drag', () => {
    const { clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointerup', 140, 100);
    click(0);
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('ignores the secondary button and the moves of another pointer', () => {
    const { events, pointer } = setup();
    pointer('pointerdown', 100, 100, { button: 2 });
    pointer('pointermove', 200, 200, { button: 2 });
    pointer('pointerup', 200, 200, { button: 2 });
    pointer('pointerdown', 100, 100);
    pointer('pointerdown', 300, 300, { pointerId: 2 });
    pointer('pointermove', 400, 400, { pointerId: 2 });
    pointer('pointerup', 400, 400, { pointerId: 2 });
    pointer('pointermove', 100, 101);
    expect(events).toEqual([]);
  });

  it('ignores moves while nothing is pressed', () => {
    const { events, pointer } = setup();
    pointer('pointermove', 200, 200);
    expect(events).toEqual([]);
  });

  it('ends a drag the browser cancels where the card is, and swallows no later click', () => {
    const { events, clicks, pointer, click } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 140);
    pointer('pointercancel', 100, 140);
    pointer('pointermove', 100, 200);
    click();
    expect(events).toEqual(['start', 'move 0,40', 'end']);
    expect(clicks).toHaveBeenCalledOnce();
  });

  it('ends a drag whose pointer capture is lost', () => {
    const { events, pointer } = setup();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 140);
    pointer('lostpointercapture', 100, 140);
    pointer('pointerup', 100, 140);
    expect(events).toEqual(['start', 'move 0,40', 'end']);
  });

  it('starts nothing when the capture is lost before the pointer moved far', () => {
    const { events, pointer } = setup();
    pointer('pointerdown', 100, 100);
    pointer('lostpointercapture', 100, 100);
    pointer('pointermove', 100, 140);
    expect(events).toEqual([]);
  });

  it('captures the pointer on the surface for a press aimed at no element of its own', () => {
    const { surface, button, pointer } = setup();
    const label = document.createTextNode('Stop');
    button.append(label);
    label.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 1 }),
    );
    expect(surface.hasPointerCapture(1)).toBe(true);
    expect(button.hasPointerCapture(1)).toBe(false);
    pointer('pointerup', 1, 0);
  });

  it('can be pressed on the surface itself', () => {
    const { surface, events, pointer } = setup();
    pointer('pointerdown', 10, 10, {}, surface);
    expect(surface.hasPointerCapture(1)).toBe(true);
    pointer('pointermove', 30, 10, {}, surface);
    pointer('pointerup', 30, 10, {}, surface);
    expect(events).toEqual(['start', 'move 20,0', 'end']);
  });
});
