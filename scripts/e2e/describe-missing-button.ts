/** What the status card shows: its state and the buttons it shows, or null when it is not mounted. */
export type CardShows = { state: string | undefined; buttons: string[] } | null;

/**
 * Says what the status card showed when a scenario's click found no button of the label it wanted:
 * its state and the buttons it did show, or that it was not mounted. Without it, a click that
 * found nothing only shows as a timeout far later, such as a wait for a file no Stop ended.
 * `withinMs` is how long the scenario waited for a button that was still coming.
 */
export function describeMissingButton(name: string, card: CardShows, withinMs?: number): string {
  const lead =
    withinMs === undefined
      ? `the status card has no ${name} button`
      : `the status card showed no ${name} button within ${withinMs / 1000} s`;
  if (card === null) return `${lead}: it is not mounted`;
  const buttons = card.buttons.length > 0 ? card.buttons.join(', ') : 'no button';
  return `${lead}: it is ${card.state ?? 'in no state'}, with ${buttons}`;
}
