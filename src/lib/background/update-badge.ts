import type { TabSnapshot } from '@/lib/types';
import { describeBadge } from '@/lib/ui/describe-badge';

export interface BadgeApi {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  setBadgeTextColor(details: { color: string }): Promise<void>;
  setTitle(details: { title: string }): Promise<void>;
}

/**
 * Toolbar badge for every meeting tab at once (`describeBadge`): a tab's lasting fault, else a
 * record dot while any tab records, II while one is paused, empty otherwise. Started on every snapshot without
 * being awaited, so it never rejects: what the browser refuses goes to `warn` (Diagnostics).
 */
export async function updateBadge(
  snapshots: Iterable<TabSnapshot>,
  action: BadgeApi,
  warn: (message: string, detail?: unknown) => void,
): Promise<void> {
  const badge = describeBadge(snapshots);
  await Promise.all([
    action.setBadgeText({ text: badge.text }),
    action.setBadgeBackgroundColor({ color: badge.color }),
    action.setBadgeTextColor({ color: badge.textColor }).catch(() => undefined),
    action.setTitle({ title: badge.title }),
  ]).catch((error: unknown) => warn('could not update the toolbar badge:', error));
}
