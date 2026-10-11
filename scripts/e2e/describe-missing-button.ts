/**
 * Says what the status card showed when a scenario's click found no button of the label it wanted:
 * its state and the buttons it did show, or that it was not mounted. Without it, a click that
 * found nothing only shows as a timeout far later, such as a wait for a file no Stop ended.
 */
export function describeMissingButton(
  name: string,
  card: { state: string | undefined; buttons: string[] } | null,
): string {
  const lead = `the status card has no ${name} button`;
  if (card === null) return `${lead}: it is not mounted`;
  const buttons = card.buttons.length > 0 ? card.buttons.join(', ') : 'no button';
  return `${lead}: it is ${card.state ?? 'in no state'}, with ${buttons}`;
}
