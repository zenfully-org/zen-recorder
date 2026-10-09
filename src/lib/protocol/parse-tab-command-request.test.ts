import { describe, expect, it } from 'vitest';
import { parseTabCommandRequest } from './parse-tab-command-request';

describe('parseTabCommandRequest', () => {
  it('accepts a meeting tab and a command', () => {
    expect(parseTabCommandRequest({ tabId: 7, command: 'pause' })).toEqual({
      tabId: 7,
      command: 'pause',
    });
  });

  it.each([
    undefined,
    { tabId: 7 },
    { command: 'stop' },
    { tabId: '7', command: 'stop' },
    { tabId: 1.5, command: 'stop' },
    { tabId: -1, command: 'stop' },
    { tabId: 7, command: 'explode' },
  ])('rejects %j', (input) => {
    expect(parseTabCommandRequest(input)).toBeNull();
  });
});
