/**
 * The on-page status card, rendered inside a shadow root by the bridge content script.
 *
 * Compact, it is a small pill: the state's glyph and, while recording, the elapsed time. A click
 * (or Enter or Space) opens the details: the state in words, the microphone, the video and the
 * Record, Pause, Resume and Stop buttons; another click, Escape or the collapse chevron closes
 * them. The card can be dragged by any part of it and remembers its place per service; messages
 * appear beside it.
 *
 * It must not get in the meeting's way: it never takes the focus by itself (a mouse press on it
 * leaves the focus where it was, so the page's shortcuts keep working), keys pressed inside it
 * stop at it, and the timer rewrites only the text that changed.
 */

import type {
  LifecycleCommand,
  OverlayPosition,
  RecordingState,
  Size,
  TabSnapshot,
} from '@/lib/types';
import { createOverlayDrag } from '@/lib/ui/create-overlay-drag';
import { createOverlayElements, type OverlayElements } from '@/lib/ui/create-overlay-elements';
import { createOverlayPlacement } from '@/lib/ui/create-overlay-placement';
import { describeOverlayState } from '@/lib/ui/describe-overlay-state';

export interface OverlayHandle {
  update(snapshot: TabSnapshot): void;
  toast(message: string, kind: 'ok' | 'error'): void;
  setEnabled(enabled: boolean): void;
  /** Closes the details, as Escape does: a key guard on the window may catch Escape first. */
  collapse(): void;
  destroy(): void;
}

export interface OverlayDeps {
  onCommand: (command: LifecycleCommand) => void;
  /** Where the person left the card on this service; null puts it at its default place. */
  position: OverlayPosition | null;
  /** Called with the card's new place once a drag ends, to remember it. */
  onPositionChange: (position: OverlayPosition) => void;
  /** The size of the area the card is placed in: the window without its scrollbars. */
  viewport: () => Size;
  /** Calls `listener` when the window is resized; returns the function that stops it. */
  onViewportResize: (listener: () => void) => () => void;
  now?: () => number;
  setInterval?: (handler: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
  setTimeout?: (handler: () => void, ms: number) => number;
  toastMs?: number;
}

const COMMANDS: readonly LifecycleCommand[] = ['start', 'pause', 'resume', 'stop'];
const TITLE = {
  open: 'Zen Recorder: hide the details. Drag to move it.',
  closed: 'Zen Recorder: show the details. Drag to move it.',
};

const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

/** Writes what the snapshot says into the card, touching only what changed. */
function paint(ui: OverlayElements, snapshot: TabSnapshot, now: number): void {
  const view = describeOverlayState(snapshot, now);
  ui.card.dataset['state'] = snapshot.state;
  ui.card.dataset['tone'] = view.tone;
  setText(ui.status, view.status);
  setText(ui.time, view.elapsed);
  setText(ui.microphone, view.microphone);
  ui.microphone.title = view.microphone;
  setText(ui.video, view.video ?? '');
  ui.videoRow.hidden = view.video === null;
  for (const command of COMMANDS) ui.actions[command].hidden = !view.actions.includes(command);
}

/**
 * A keyboard user's focus stays in the card when the button it was on goes away (Pause turns
 * into Resume): it moves to the first action left, or to the status row.
 */
function keepFocus(ui: OverlayElements, shadow: ShadowRoot): void {
  const focused = shadow.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.hidden) return;
  const next = COMMANDS.map((command) => ui.actions[command]).find((button) => !button.hidden);
  (next ?? ui.toggle).focus();
}

/**
 * The card's input stays the card's: a click on it is no click on the call's stage, a key pressed
 * on it is no shortcut of the page, and a mouse press on it leaves the focus where it was, so the
 * page's shortcuts keep working.
 */
function keepInputIn(ui: OverlayElements): void {
  ui.root.addEventListener('click', (event) => event.stopPropagation());
  ui.card.addEventListener('mousedown', (event) => event.preventDefault());
  for (const type of ['keydown', 'keyup', 'keypress']) {
    ui.root.addEventListener(type, (event) => event.stopPropagation());
  }
}

export function mountOverlay(shadow: ShadowRoot, deps: OverlayDeps): OverlayHandle {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.setInterval ?? ((handler, ms) => window.setInterval(handler, ms));
  const cancel = deps.clearInterval ?? ((id) => clearInterval(id));
  const later = deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
  const doc = shadow.ownerDocument;
  const ui = createOverlayElements(doc);
  shadow.append(ui.style, ui.root);
  const placement = createOverlayPlacement(ui, deps);
  createOverlayDrag(ui.card, placement);

  let enabled = true;
  let current: TabSnapshot | null = null;
  let expanded = false;
  let placed: { visible: boolean; state: RecordingState | null } = { visible: false, state: null };

  const render = (): void => {
    if (!current) return;
    paint(ui, current, now());
    const visible = enabled && current.meetingCode !== null;
    ui.card.dataset['visible'] = String(visible);
    keepFocus(ui, shadow);
    // The card's size changes with its state; the timer's ticks leave its place alone.
    const { state } = current;
    if (visible === placed.visible && state === placed.state) return;
    placed = { visible, state };
    if (visible) placement.apply();
  };
  const setExpanded = (value: boolean): void => {
    expanded = value;
    ui.card.dataset['expanded'] = String(value);
    ui.toggle.setAttribute('aria-expanded', String(value));
    ui.toggle.title = value ? TITLE.open : TITLE.closed;
    ui.details.hidden = !value;
    placement.apply();
  };
  setExpanded(false);

  ui.toggle.addEventListener('click', () => setExpanded(!expanded));
  for (const command of COMMANDS) {
    ui.actions[command].addEventListener('click', () => deps.onCommand(command));
  }
  keepInputIn(ui);
  /** A keyboard user in the details stays in the card: the focus goes to the status row. */
  const collapse = (): void => {
    if (!expanded) return;
    const inside = ui.details.contains(shadow.activeElement);
    setExpanded(false);
    if (inside) ui.toggle.focus();
  };
  ui.root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') collapse();
  });
  const unwatch = deps.onViewportResize(() => placement.apply());
  const timer = schedule(render, 1000);

  return {
    update(snapshot) {
      current = snapshot;
      render();
    },
    toast(message, kind) {
      const toast = doc.createElement('div');
      toast.className = 'zr-toast';
      toast.dataset['kind'] = kind;
      toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      toast.textContent = message;
      ui.toasts.append(toast);
      later(() => toast.remove(), deps.toastMs ?? 8000);
    },
    setEnabled(value) {
      enabled = value;
      render();
    },
    collapse,
    destroy() {
      cancel(timer);
      unwatch();
      ui.root.remove();
      ui.style.remove();
    },
  };
}
