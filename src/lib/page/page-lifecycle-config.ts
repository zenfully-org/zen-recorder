/**
 * The rules the recording lifecycle follows on a meeting page: when to start, from the settings the
 * bridge sent, and the page session's fixed limits.
 */
import type { LifecycleConfig } from '@/lib/page/reduce-lifecycle';
import type { PageConfig } from '@/lib/types';

/** How long every connection may be dead before the recording stops. */
const DEAD_CONNECTION_GRACE_MS = 5_000;
/** A broken encoder fails within seconds: after this many restarts in a row the session gives up. */
const MAX_ENCODER_RESTARTS = 3;
/** A failure later than this after the previous one is the first of a new run. */
const ENCODER_FAILURE_WINDOW_MS = 60_000;

export function pageLifecycleConfig(
  config: Pick<PageConfig, 'autoRecord' | 'startRule'>,
): LifecycleConfig {
  return {
    autoRecord: config.autoRecord,
    startRule: config.startRule,
    deadConnectionGraceMs: DEAD_CONNECTION_GRACE_MS,
    maxEncoderRestarts: MAX_ENCODER_RESTARTS,
    encoderFailureWindowMs: ENCODER_FAILURE_WINDOW_MS,
  };
}
