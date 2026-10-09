import type { LifecycleCommand } from '@/lib/types';
import { createOverlayIcon, type OverlayIconName } from '@/lib/ui/create-overlay-icon';
import { getOverlayStyle } from '@/lib/ui/get-overlay-style';

/** The status card's elements, built once; `mountOverlay` fills them in. */
export interface OverlayElements {
  style: HTMLStyleElement;
  /** Placed on the page; holds the card and, beside it, the messages. */
  root: HTMLDivElement;
  card: HTMLDivElement;
  /** The status row: the compact form on its own, and what opens and closes the details. */
  toggle: HTMLButtonElement;
  glyph: HTMLSpanElement;
  status: HTMLSpanElement;
  time: HTMLSpanElement;
  /** A lasting fault in a few words, on the compact card. */
  alert: HTMLSpanElement;
  details: HTMLDivElement;
  /** The same fault in full, first in the details. */
  notice: HTMLParagraphElement;
  microphone: HTMLElement;
  videoRow: HTMLDivElement;
  video: HTMLElement;
  actions: Record<LifecycleCommand, HTMLButtonElement>;
  toasts: HTMLDivElement;
}

const ACTIONS: Record<LifecycleCommand, { label: string; icon: OverlayIconName }> = {
  start: { label: 'Record', icon: 'record' },
  pause: { label: 'Pause', icon: 'pause' },
  resume: { label: 'Resume', icon: 'resume' },
  stop: { label: 'Stop', icon: 'stop' },
};

/** A command's button: its icon and its words. */
function createAction(doc: Document, command: LifecycleCommand): HTMLButtonElement {
  const button = doc.createElement('button');
  button.className = 'zr-btn';
  button.type = 'button';
  button.dataset['command'] = command;
  button.append(createOverlayIcon(doc, ACTIONS[command].icon), ACTIONS[command].label);
  return button;
}

export function createOverlayElements(doc: Document): OverlayElements {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const fact = (term: string, value: HTMLElement) => {
    const row = el('div', 'zr-fact');
    row.append(el('dt', '', term), value);
    return row;
  };

  const style = el('style', '', getOverlayStyle());
  const glyph = el('span', 'zr-glyph');
  glyph.setAttribute('aria-hidden', 'true');
  const status = el('span', 'zr-status');
  const time = el('span', 'zr-time');
  const alert = el('span', 'zr-alert');
  const toggle = el('button', 'zr-toggle');
  toggle.type = 'button';
  toggle.append(
    glyph,
    el('span', 'zr-sr', 'Zen Recorder: '),
    status,
    time,
    alert,
    createOverlayIcon(doc, 'chevron'),
  );

  const microphone = el('dd', 'zr-mic');
  const video = el('dd', 'zr-video');
  const videoRow = fact('Video', video);
  videoRow.classList.add('zr-video-row');
  const facts = el('dl', 'zr-facts');
  facts.append(fact('Microphone', microphone), videoRow);
  const actions = {
    start: createAction(doc, 'start'),
    pause: createAction(doc, 'pause'),
    resume: createAction(doc, 'resume'),
    stop: createAction(doc, 'stop'),
  };
  const buttons = el('div', 'zr-actions');
  buttons.append(...Object.values(actions));
  const notice = el('p', 'zr-notice');
  notice.hidden = true;
  const details = el('div', 'zr-details');
  details.id = 'zr-details';
  details.hidden = true;
  details.setAttribute('role', 'group');
  details.setAttribute('aria-label', 'Zen Recorder');
  details.append(notice, facts, buttons);
  toggle.setAttribute('aria-controls', details.id);
  toggle.setAttribute('aria-expanded', 'false');

  const card = el('div', 'zr-card');
  card.append(toggle, details);
  const toasts = el('div', 'zr-toasts');
  toasts.setAttribute('aria-live', 'polite');
  const root = el('div', 'zr-overlay');
  root.append(card, toasts);
  return {
    style,
    root,
    card,
    toggle,
    glyph,
    status,
    time,
    alert,
    details,
    notice,
    microphone,
    videoRow,
    video,
    actions,
    toasts,
  };
}
