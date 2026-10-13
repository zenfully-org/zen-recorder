/**
 * The events a recording's notes get from what the page shows of the call and of the user, beyond
 * its own lifecycle: the connection (`createConnectionEvents`), the microphone (written once a
 * state held 4 s: Zoom shows "audio not joined" for about 3 s during its own reconnects), the
 * meeting's title (once it held 5 s, unread counts like "(3) " left out, an
 * empty one ignored), and whether the tab is visible (a hidden tab may show fewer people: a span
 * of the participants signal not fully observed, once it was hidden 1 s, as switching tabs can
 * hide one for a few milliseconds). A held change keeps the moment it was first seen, and counts
 * when the page sees it end, or at the stop, as well as while it lasts. What the page showed at the
 * start is the baseline, and the start itself says it.
 *
 * The microphone is the page's own three states where the service shows them (`pageMic`, from
 * the presence reading), else the recording's: between on and muted, as the page shows it, a
 * state is written once it held 1 s (push-to-talk); any change to or from "not connected" keeps
 * the 4 s.
 */
import { createConnectionEvents } from '@/lib/page/create-connection-events';
import { createHeldState, type HeldChange } from '@/lib/page/create-held-state';
import type { MeetingEventBody, MicState } from '@/lib/types';

/** How long a microphone state, a title and a hidden tab must hold before the notes write it. */
const MIC_HOLD_MS = 4_000;
const PAGE_MUTE_HOLD_MS = 1_000;
const TITLE_HOLD_MS = 5_000;
const HIDDEN_HOLD_MS = 1_000;

/** What the page shows of the call and of the user at one moment. */
export interface Seen {
  /** Any connection of the call is up. */
  connected: boolean;
  /** The user's microphone, as the recording hears it. */
  mic: MicState;
  /** The meeting's title as the page shows it. */
  title: string;
  /** The tab is really visible; null when the page cannot tell. */
  visible: boolean | null;
  /** The user shares a screen from the page; null when the recorder cannot see it. */
  ownShare: boolean | null;
}

type Body = MeetingEventBody;

const TAB_HIDDEN = { signal: 'participants', reason: 'tab-hidden' } as const;

/** A tab's title without the count of unread messages some pages put before it. */
const withoutUnreadCount = (title: string): string => title.replace(/^\(\d+\+?\)\s*/, '').trim();

const onOrMuted = (state: MicState) => state !== 'not-connected';

/** An event to write, with what was remembered of the moment it was first seen. */
type Told<Stamp> = { stamp: Stamp; body: Body };

/** The change a held state makes if it still holds at `atMs`, as a list. */
const held = <Value, Stamp>(
  state: { heldBy: (atMs: number) => HeldChange<Value, Stamp> | null },
  atMs: number,
): HeldChange<Value, Stamp>[] => {
  const change = state.heldBy(atMs);
  return change ? [change] : [];
};

/** The events the signals' changes make, in the order they are written. */
function tell<Stamp>(changes: {
  connection: Told<Stamp>[];
  mic: HeldChange<MicState, Stamp>[];
  titles: HeldChange<string, Stamp>[];
  tab: HeldChange<boolean | null, Stamp>[];
}): Told<Stamp>[] {
  const told = [...changes.connection];
  for (const { seen, value } of changes.mic) {
    told.push({ stamp: seen, body: { type: 'mic', state: value } });
  }
  for (const { seen, value } of changes.titles) {
    told.push({ stamp: seen, body: { type: 'title-changed', title: value } });
  }
  for (const { seen, value, from } of changes.tab) {
    if (value === false) told.push({ stamp: seen, body: { type: 'coverage-lost', ...TAB_HIDDEN } });
    if (value === true && from === false) {
      told.push({ stamp: seen, body: { type: 'coverage-restored', ...TAB_HIDDEN } });
    }
  }
  return told;
}

/**
 * From what the page showed at the recording's start (`start`, and `startPageMic`, the page's own
 * microphone state then, null where it shows none).
 */
export function createSignalEvents<Stamp extends { atMs: number }>(
  start: Seen,
  startPageMic: MicState | null = null,
) {
  /** The page shows the microphone's state: its own word decides, on and muted held 1 s. */
  let fromPage = startPageMic !== null;
  const connection = createConnectionEvents<Stamp>(start.connected);
  const mic = createHeldState<MicState, Stamp>({
    initial: startPageMic ?? start.mic,
    holdMs: (to, from) =>
      fromPage && onOrMuted(to) && onOrMuted(from) ? PAGE_MUTE_HOLD_MS : MIC_HOLD_MS,
  });
  const title = createHeldState<string, Stamp>({
    initial: withoutUnreadCount(start.title),
    holdMs: () => TITLE_HOLD_MS,
  });
  const visible = createHeldState<boolean | null, Stamp>({
    initial: start.visible,
    holdMs: (shown) => (shown === false ? HIDDEN_HOLD_MS : 0),
  });

  return {
    /** What a start writes beside itself: a hidden tab is a span the recording starts in. */
    atStart: (): Body[] =>
      start.visible === false ? [{ type: 'coverage-lost', ...TAB_HIDDEN }] : [],
    /** `seen` at `atMs`: the events it settles, each with the moment it was first seen. */
    observe(
      seen: Seen,
      atMs: number,
      stamp: () => Stamp,
      pageMic: MicState | null = null,
    ): Told<Stamp>[] {
      fromPage = pageMic !== null;
      const shown = withoutUnreadCount(seen.title);
      return tell({
        connection: connection.observe(seen.connected, atMs, stamp),
        mic: mic.observe(pageMic ?? seen.mic, atMs, stamp),
        titles: shown === '' ? [] : title.observe(shown, atMs, stamp),
        tab: visible.observe(seen.visible, atMs, stamp),
      });
    },
    /**
     * At a stop at `atMs`, after which nothing is observed: what held long enough by then, each
     * with the moment it was first seen. Asked again, it says the same.
     */
    atStop: (atMs: number): Told<Stamp>[] =>
      tell({
        connection: connection.atStop(atMs),
        mic: held(mic, atMs),
        titles: held(title, atMs),
        tab: held(visible, atMs),
      }),
  };
}
