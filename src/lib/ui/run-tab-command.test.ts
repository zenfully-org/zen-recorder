import { describe, expect, it, vi } from 'vitest';
import { runTabCommand } from './run-tab-command';

describe('runTabCommand', () => {
  it('sends the command to its meeting tab and resolves with null once it went through', async () => {
    const send = vi.fn(async () => undefined);
    await expect(runTabCommand('pause', 7, send)).resolves.toBeNull();
    expect(send).toHaveBeenCalledWith('sendCommand', { tabId: 7, command: 'pause' });
  });

  it.each([
    { command: 'start', said: 'Could not start recording' },
    { command: 'pause', said: 'Could not pause the recording' },
    { command: 'resume', said: 'Could not resume the recording' },
    { command: 'stop', said: 'Could not stop and save the recording' },
  ] as const)('says what $command could not do, and why', async ({ command, said }) => {
    const send = vi.fn(async () => {
      throw new Error('the meeting tab is no longer connected');
    });
    await expect(runTabCommand(command, 7, send)).resolves.toBe(
      `${said}: the meeting tab is no longer connected`,
    );
  });

  it('says why when the request failed with something other than an Error', async () => {
    const send = vi.fn(() => Promise.reject('the extension is updating'));
    await expect(runTabCommand('stop', 7, send)).resolves.toBe(
      'Could not stop and save the recording: the extension is updating',
    );
  });
});
