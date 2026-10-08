/** Where the user is in Teams' call flow, as told by the screen the page is showing. */
export type TeamsCallScreen = 'none' | 'prejoin' | 'connecting' | 'lobby' | 'call';

/**
 * Each step before the call has a screen of its own (`data-tid`); the call itself is the toolbar's
 * hang-up button. A waiting screen wins: Teams connects media in the lobby, and the lobby keeps
 * the pre-join controls in the page.
 */
export function readTeamsCallScreen(root: ParentNode): TeamsCallScreen {
  if (root.querySelector('[data-tid="calling-lobby-screen"]')) return 'lobby';
  if (root.querySelector('[data-tid="calling-connecting-screen"]')) return 'connecting';
  if (root.querySelector('[data-tid="calling-prejoin-screen"]')) return 'prejoin';
  if (root.querySelector('[data-cid="call-screen-wrapper"] #hangup-button')) return 'call';
  return 'none';
}
