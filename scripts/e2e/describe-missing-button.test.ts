import { describe, expect, it } from 'vitest';
import { describeMissingButton } from './describe-missing-button';

describe('describeMissingButton', () => {
  it.each<[string, Parameters<typeof describeMissingButton>[1], string]>([
    [
      'a card in another state',
      { state: 'idle', buttons: ['Record'] },
      'the status card has no Stop button: it is idle, with Record',
    ],
    [
      'a card with no button showing',
      { state: 'waiting', buttons: [] },
      'the status card has no Stop button: it is waiting, with no button',
    ],
    [
      'a card that names no state',
      { state: undefined, buttons: ['Record', 'Pause'] },
      'the status card has no Stop button: it is in no state, with Record, Pause',
    ],
    ['no card at all', null, 'the status card has no Stop button: it is not mounted'],
  ])('says what the card shows: %s', (_, card, expected) => {
    expect(describeMissingButton('Stop', card)).toBe(expected);
  });
});
