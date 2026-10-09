/**
 * How many people are in a Meet call, the user included, as the in-call page counts them: the
 * `data-avatar-count` attribute of its people badge. A data attribute, so it reads the same in
 * every UI language. Someone who joined muted, with the camera off, counts too, which no media
 * signal shows: Meet sends audio only for the people speaking.
 *
 * Not verified live in Firefox yet. Other open-source Meet bots read the same attribute and take 2
 * as "someone else is here" (screenapp's meeting-bot, `src/bots/GoogleMeetBot.ts`). Null when the
 * badge is missing or does not hold a whole number of at least 1.
 */

const COUNT_RE = /^\d+$/;

export function readMeetParticipantCount(root: ParentNode): number | null {
  const count = root
    .querySelector('[data-avatar-count]')
    ?.getAttribute('data-avatar-count')
    ?.trim();
  if (count === undefined || !COUNT_RE.test(count)) return null;
  const people = Number(count);
  return people >= 1 ? people : null;
}
