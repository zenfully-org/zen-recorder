/**
 * Says which step of the bridge's start did not happen when a meeting page's status card did not
 * mount in time. In order, the bridge (the extension's content script) starts and logs it, reads
 * its settings from the extension's storage and configures the page's recorder with them, then
 * reads where the card was left and mounts it once the page has a body.
 */

export interface CardWait {
  /** The bridges whose start line the page logged, oldest first. */
  bridgesStarted: string[];
  /**
   * The page's recorder, null when it is not running. `configuredBy` names the bridge that
   * configured it: null before one did, undefined from a recorder too old to say.
   */
  recorder: { configuredBy: string | null | undefined } | null;
}

export function describeCardWait({ bridgesStarted, recorder }: CardWait): string {
  const bridge = bridgesStarted.at(-1);
  if (bridge === undefined) {
    return "no bridge started in the page: the extension's content scripts did not run there";
  }
  if (recorder === null) {
    return `bridge ${bridge} started, and the page's recorder is not running, so whether the bridge read its settings is unknown`;
  }
  if (recorder.configuredBy === undefined) {
    return `bridge ${bridge} started, and the page's recorder is too old to say whether a bridge configured it`;
  }
  if (recorder.configuredBy === null) {
    return `bridge ${bridge} started but has not configured the page's recorder: its read of the settings from the extension's storage has not returned`;
  }
  return `bridge ${recorder.configuredBy} configured the page's recorder but has not mounted the card: it waits for the page's body or for where the card was left (the extension's storage)`;
}
