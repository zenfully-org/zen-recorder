/** Sends a meeting tab's Record now, Pause, Resume or Stop & save from the popup. */
import type { LifecycleCommand } from '@/lib/types';

const WHAT_FAILED: Record<LifecycleCommand, string> = {
  start: 'Could not start recording',
  pause: 'Could not pause the recording',
  resume: 'Could not resume the recording',
  stop: 'Could not stop and save the recording',
};

/**
 * Sends `command` to the meeting tab `tabId` through the background. Resolves with what to tell
 * the person when it fails, the reason included, or with `null` when it went through: a failed
 * click is never silent.
 */
export function runTabCommand(
  command: LifecycleCommand,
  tabId: number,
  send: (
    type: 'sendCommand',
    data: { tabId: number; command: LifecycleCommand },
  ) => Promise<unknown>,
): Promise<string | null> {
  return send('sendCommand', { tabId, command }).then(
    () => null,
    (error: unknown) =>
      `${WHAT_FAILED[command]}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
