import { type CardShows, describeMissingButton } from './describe-missing-button';

/** What a click on a status card's button did: it clicked, or the card showed no such button. */
export type CardClick = { clicked: true } | { clicked: false; card: CardShows };

/**
 * Presses a status card button that comes with a change the scenario just caused or saw in the
 * page: Pause once a recording started, Resume once Pause was pressed. The card follows the page's
 * state one message later than the page has it, so a click at once can come first on a busy
 * machine. Tries `click` until it clicks (for 10 s by default), and fails with what the card
 * showed at the last try.
 */
export async function pressWhenShown(
  name: string,
  click: () => Promise<CardClick>,
  timeoutMs = 10_000,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let result = await click();
  while (!result.clicked && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    result = await click();
  }
  if (!result.clicked) throw new Error(describeMissingButton(name, result.card, timeoutMs));
}
