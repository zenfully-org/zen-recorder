import type { TabSnapshot } from '@/lib/types';

export interface BadgeApi {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  setBadgeTextColor(details: { color: string }): Promise<void>;
  setTitle(details: { title: string }): Promise<void>;
}

/** Toolbar badge: REC while any tab records, II while one is paused, empty otherwise. */
export async function updateBadge(
  snapshots: Iterable<TabSnapshot>,
  action: BadgeApi,
): Promise<void> {
  let recording = false;
  let paused = false;
  for (const s of snapshots) {
    if (s.state === 'recording') recording = true;
    else if (s.state === 'paused') paused = true;
  }
  const text = recording ? 'REC' : paused ? 'II' : '';
  const title = recording
    ? 'Zen Recorder: recording'
    : paused
      ? 'Zen Recorder: paused'
      : 'Zen Recorder';
  await Promise.all([
    action.setBadgeText({ text }),
    action.setBadgeBackgroundColor({ color: recording ? '#d7263d' : '#f4a261' }),
    action.setBadgeTextColor({ color: '#ffffff' }).catch(() => undefined),
    action.setTitle({ title }),
  ]);
}
