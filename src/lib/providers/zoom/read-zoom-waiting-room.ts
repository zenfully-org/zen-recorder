/**
 * How many people the Zoom web client shows in its waiting room. Only a host or co-host is shown
 * the waiting room, and their participant counter counts it too (verified live on 2026-10-01), so
 * a guest who knocks would otherwise look like someone in the meeting.
 *
 * Read from the client's bundle (web client 7.2.0.1.12783, 2026-10-04), not verified live yet.
 * While the participants panel is closed, the label of the Participants button names the waiting
 * room; the client builds that label from fixed English text and does not translate it. While the
 * panel is open, its waiting-room section title ends in the count. Both can only read fewer people
 * than are waiting, never more: an unreadable label means nobody waiting, which is how the provider
 * counted before.
 */

/** The counter sits inside the Participants button, next to a separate "Participants Settings" toggle. */
const COUNTER = '#participant .footer-button__number-counter';
/** `open the manage participants list pane,2 particpants,1 people are in waiting room`. */
const LABEL_COUNT = /,(\d+) people are in waiting room$/;
/** The open panel's section title: `Waiting Room (1)`, its label translated, the count not. */
const SECTION_TITLE =
  '.waiting-room-list-container__title-section .collapsible-section-title__trigger';
const TITLE_COUNT = /\((\d+)\)$/;

function countIn(text: string | null | undefined, pattern: RegExp): number {
  const match = pattern.exec(text?.trim() ?? '');
  return match ? Number(match[1]) : 0;
}

export function readZoomWaitingRoom(root: ParentNode): number {
  const label = root.querySelector(COUNTER)?.closest('button')?.getAttribute('aria-label');
  const title = root.querySelector(SECTION_TITLE)?.textContent;
  return Math.max(countIn(label, LABEL_COUNT), countIn(title, TITLE_COUNT));
}
