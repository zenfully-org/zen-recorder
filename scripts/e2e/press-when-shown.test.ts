// @vitest-environment node
import { type CardClick, pressWhenShown } from './press-when-shown';

const STILL_WAITING: CardClick = {
  clicked: false,
  card: { state: 'waiting', buttons: ['Record'] },
};
const CLICKED: CardClick = { clicked: true };

/** A click that gives each result in turn, then the last one for good. */
function clicks(...results: CardClick[]): () => Promise<CardClick> {
  let index = 0;
  return async () => results[Math.min(index++, results.length - 1)] ?? CLICKED;
}

describe('pressWhenShown', () => {
  it('presses a button the card already shows at once', async () => {
    const click = vi.fn(clicks(CLICKED));

    await pressWhenShown('Pause', click, 1_000, 1);

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('tries again until the card shows the button, and stops once it pressed it', async () => {
    const click = vi.fn(clicks(STILL_WAITING, STILL_WAITING, CLICKED));

    await pressWhenShown('Pause', click, 1_000, 1);

    expect(click).toHaveBeenCalledTimes(3);
  });

  it('fails once the deadline has passed, saying what the card showed at the last try', async () => {
    const unmounted: CardClick = { clicked: false, card: null };

    await expect(pressWhenShown('Pause', clicks(unmounted, STILL_WAITING), 30, 1)).rejects.toThrow(
      'the status card showed no Pause button within 0.03 s: it is waiting, with Record',
    );
  });
});
