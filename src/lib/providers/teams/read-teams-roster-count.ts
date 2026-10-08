const COUNT_RE = /^(\d+)\+?$/;

/**
 * How many people are in the call, the user included, as shown on the People button's badge; null
 * when the badge is not there or does not show a number.
 */
export function readTeamsRosterCount(root: ParentNode): number | null {
  const badge = root.querySelector('#roster-button [data-tid="toolbar-item-badge"]');
  const count = COUNT_RE.exec(badge?.textContent?.trim() ?? '')?.[1];
  return count === undefined ? null : Number(count);
}
