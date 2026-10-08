import { describe, expect, it } from 'vitest';
import { parseBridgeCommand } from './parse-bridge-command';

describe('parseBridgeCommand', () => {
  it.each(['start', 'pause', 'resume', 'stop'] as const)('accepts %s', (command) => {
    expect(parseBridgeCommand({ command })).toBe(command);
  });

  it.each([
    ['undefined', undefined],
    ['a bare string', 'stop'],
    ['an unknown command', { command: 'restart' }],
    ['a missing command', {}],
  ])('rejects %s', (_label, input) => {
    expect(parseBridgeCommand(input)).toBeNull();
  });
});
