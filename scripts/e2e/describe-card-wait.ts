/**
 * Says which step of the bridge's start did not happen when a meeting page's status card did not
 * show the tab's state in time. In order, the bridge (the extension's content script) starts and
 * logs it, reads its settings from the extension's storage and configures the page's recorder
 * with them, then reads where the card was left and mounts it once the page has a body. The card
 * has its first update once the recorder's first snapshot, which it sends when configured, has
 * reached the bridge.
 */

export interface CardWait {
  /** The bridges whose start line the page logged, oldest first. */
  bridgesStarted: string[];
  /**
   * The page's recorder, null when it is not running. `configuredBy` names the bridge that
   * configured it: null before one did, undefined from a recorder too old to say.
   */
  recorder: { configuredBy: string | null | undefined } | null;
  /** Whether the card is mounted: then only its first update is missing. */
  mounted: boolean;
}

/** The card is mounted and has had no update: says what kept the page's first snapshot from it. */
function describeFirstUpdateWait(bridge: string, recorder: CardWait['recorder']): string {
  const lead = `bridge ${bridge} mounted the card, but the card has had no update`;
  if (recorder === null) {
    return `${lead}: the page's recorder is not running, so nothing tells the card what the tab is doing`;
  }
  if (recorder.configuredBy === null) {
    return `${lead}: the bridge has not configured the page's recorder, which sends its first snapshot once configured`;
  }
  return `${lead}: no snapshot from the page's recorder has reached the bridge`;
}

export function describeCardWait({ bridgesStarted, recorder, mounted }: CardWait): string {
  const bridge = bridgesStarted.at(-1);
  if (bridge === undefined) {
    return "no bridge started in the page: the extension's content scripts did not run there";
  }
  if (mounted) return describeFirstUpdateWait(bridge, recorder);
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
