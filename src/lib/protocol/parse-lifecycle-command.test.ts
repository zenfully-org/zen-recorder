import { describe, expect, it } from 'vitest';
import { parseLifecycleCommand } from './parse-lifecycle-command';

describe('parseLifecycleCommand', () => {
  it.each(['start', 'pause', 'resume', 'stop'] as const)('accepts %s', (command) => {
    expect(parseLifecycleCommand(command)).toBe(command);
  });

  it.each(['restart', '', 1, null, { command: 'stop' }])('rejects %j', (input) => {
    expect(parseLifecycleCommand(input)).toBeNull();
  });
});
