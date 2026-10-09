/**
 * What a tab snapshot says of the page's lifecycle: its status, whether the call admitted the
 * user, and whether the recorder gave up on a broken encoder, so the tab says why nothing records.
 */
import { hasGivenUpOnEncoder } from '@/lib/page/has-given-up-on-encoder';
import type { LifecycleState } from '@/lib/page/reduce-lifecycle';
import type { TabSnapshot } from '@/lib/types';

export function lifecycleSnapshot(
  lifecycle: LifecycleState | undefined,
  config: { maxEncoderRestarts: number },
): Pick<TabSnapshot, 'state' | 'admitted' | 'encoderGaveUp'> {
  if (!lifecycle) return { state: 'idle', admitted: false };
  return {
    state: lifecycle.status,
    admitted: lifecycle.inputs.admitted,
    ...(hasGivenUpOnEncoder(lifecycle, config) ? { encoderGaveUp: true } : {}),
  };
}
