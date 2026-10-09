import { describe, expect, it } from 'vitest';
import { createFakeMessageChannel } from '@/test/fakes/create-fake-message-channel';
import { parseMessagePort } from './parse-message-port';

describe('parseMessagePort', () => {
  it('returns the port itself, not a copy, so its methods keep working', () => {
    const { port2 } = createFakeMessageChannel();
    expect(parseMessagePort(port2)).toBe(port2);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'port'],
    ['an event target without postMessage', new EventTarget()],
    [
      'an object whose methods are not functions',
      {
        postMessage: 1,
        start: 1,
        close: 1,
        addEventListener: 1,
        removeEventListener: 1,
        dispatchEvent: 1,
      },
    ],
  ])('refuses %s', (_name, value) => {
    expect(parseMessagePort(value)).toBeNull();
  });
});
