const MIC_ON_ICON = 'ubar-mic-on-icon';

/**
 * The microphone state Teams' own UI shows, or null when the page has no microphone control.
 * Teams sends a different track than the one `getUserMedia` returned and mutes that one, so the
 * track the recorder mirrors never changes: the UI is the only place the mute state can be read.
 * Locale-proof: the toolbar icon's test id in a call (`ubar-mic-on|off|prohibited-icon`), the
 * microphone switch (`data-cid="toggle-mute-true"` = on) on the pre-join screen and in the lobby.
 */
export function readTeamsMicMuted(root: ParentNode): boolean | null {
  const icon = root.querySelector('#mic-button svg[data-testid^="ubar-mic-"]');
  // Anything but the "on" icon (off, prohibited, a future one) is treated as muted.
  if (icon) return icon.getAttribute('data-testid') !== MIC_ON_ICON;
  const state = root.querySelector('input[data-tid="toggle-mute"]')?.getAttribute('data-cid');
  if (state === 'toggle-mute-true') return false;
  if (state === 'toggle-mute-false') return true;
  return null;
}
