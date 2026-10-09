/**
 * Test builds: the diagnostics probes that open the popup's page and press its buttons. The test
 * browser may not open or drive the extension's own pages, so the background opens the page in a
 * tab, finds its window with `extension.getViews`, clicks with `element.click()` and reads the
 * DOM. React handles such a click, but it is not the person's input: the page has no user
 * activation, so Firefox refuses it a clipboard write, as it does once a real click's activation
 * has expired. Covered by the e2e run.
 */
import { browser } from '#imports';
import type { RecordingManager } from '@/lib/background/create-recording-manager';

const POPUP_PATH = '/popup.html';

/** One of the extension's pages: `extension.getViews` is typed as returning empty objects. */
const isPageWindow = (view: unknown): view is Window =>
  typeof view === 'object' && view !== null && 'document' in view && 'location' in view;

/** Calls `read` every 250 ms until it returns something, at most `attempts` times. */
async function poll<T>(read: () => T | null, attempts: number): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const popupView = (): Window | undefined =>
  browser.extension
    .getViews({ type: 'tab' })
    .filter(isPageWindow)
    .find((view) => view.location.pathname.endsWith(POPUP_PATH));

const textOf = (element: Element | null | undefined): string => element?.textContent?.trim() ?? '';

/** What a rejection says; the popup's errors come from its own window, not this one's `Error`. */
const describeReason = (reason: unknown): string =>
  typeof reason === 'object' && reason !== null && 'message' in reason
    ? String(reason.message)
    : String(reason);

/** The meeting tabs' cards: the first section's `<div>` children, in the background's tab order. */
const tabCards = (view: Window): Element[] =>
  Array.from(view.document.querySelectorAll('main > section:first-of-type > div'));

/**
 * Opens the popup's page in a tab, clicks `label` in the newest recording's row (or nothing, with
 * null), and returns the row's text, its buttons and the failure the row shows within 3 s of the
 * click, or an empty one.
 */
async function pressRecordingButton(label: string | null): Promise<unknown> {
  const url = browser.runtime.getURL(POPUP_PATH);
  const tab = await browser.tabs.create({ url, active: false });
  try {
    const row = await poll(() => popupView()?.document.querySelector('li') ?? null, 40);
    if (!row) return { error: 'the popup listed no recording' };
    const text = row.textContent ?? '';
    const buttons = Array.from(row.querySelectorAll('button'));
    const button = buttons.find((candidate) => textOf(candidate) === label);
    button?.click();
    const failure = button
      ? await poll(() => textOf(row.querySelector('[role="alert"]')) || null, 12)
      : null;
    return { text, buttons: buttons.map(textOf), failure: failure ?? '' };
  } finally {
    if (tab.id !== undefined) await browser.tabs.remove(tab.id);
  }
}

interface OpenPopup {
  tabId: number | undefined;
  view: Window;
  /** The meeting tabs the popup showed when it was frozen, in the order of its cards. */
  tabIds: number[];
  /** What the popup's page left unhandled since it was opened. */
  rejections: string[];
}

export function createPopupProbes(
  manager: Pick<RecordingManager, 'tabs'>,
): Record<string, () => Promise<unknown>> {
  let open: OpenPopup | null = null;
  const rejections = () => open?.rejections ?? [];
  return {
    // Show file in the newest recording's row of the popup, and what the row says then.
    'popup:show-file': () => pressRecordingButton('Show file'),
    'popup:recording-row': () => pressRecordingButton(null),
    'popup:retry-save': () => pressRecordingButton('Retry save'),
    // Opens the popup once it shows a card for every meeting tab, and stops its refresh timers,
    // so its cards stay as they were: a click on one then comes before the next refresh would.
    'popup:open-frozen': async () => {
      const tab = await browser.tabs.create({
        url: browser.runtime.getURL(POPUP_PATH),
        active: false,
      });
      const view = await poll(() => {
        const candidate = popupView();
        const count = manager.tabs().length;
        return candidate && count > 0 && tabCards(candidate).length === count ? candidate : null;
      }, 40);
      if (!view) return { error: 'the popup showed no card for every meeting tab' };
      const last = view.setTimeout(() => undefined, 0);
      for (let id = 1; id <= last; id++) view.clearInterval(id);
      open = { tabId: tab.id, view, tabIds: manager.tabs().map((t) => t.tabId), rejections: [] };
      const unhandled = open.rejections;
      view.addEventListener('unhandledrejection', (event) => {
        unhandled.push(describeReason(event.reason));
      });
      return { cards: open.tabIds.length };
    },
    // Once the background has lost a meeting tab whose card the frozen popup still shows, presses
    // that card's first button, and returns what the popup says within 3 s.
    'popup:press-lost-tab-command': async () => {
      const popup = open;
      if (!popup) return { error: 'no popup is open (popup:open-frozen)' };
      const index = await poll(() => {
        const connected = new Set(manager.tabs().map((t) => t.tabId));
        const lost = popup.tabIds.findIndex((tabId) => !connected.has(tabId));
        return lost === -1 ? null : lost;
      }, 40);
      if (index === null) return { error: 'no meeting tab went away' };
      const button = tabCards(popup.view)[index]?.querySelector('button');
      if (!button) return { error: 'the lost tab has no card with a button' };
      button.click();
      const failure = await poll(
        () =>
          textOf(
            popup.view.document.querySelector('main > section:first-of-type > [role="alert"]'),
          ) || null,
        12,
      );
      return { button: textOf(button), failure: failure ?? '', rejections: rejections() };
    },
    // Presses Diagnostics and returns the button's label and what the popup says within 3 s.
    'popup:press-diagnostics': async () => {
      const popup = open;
      if (!popup) return { error: 'no popup is open (popup:open-frozen)' };
      const header = popup.view.document.querySelector('header');
      const button = Array.from(header?.querySelectorAll('button') ?? []).find(
        (candidate) => textOf(candidate) === 'Diagnostics',
      );
      if (!button) return { error: 'the popup has no Diagnostics button' };
      button.click();
      const failure = await poll(
        () =>
          textOf(button) === 'Copied'
            ? ''
            : textOf(popup.view.document.querySelector('main > [role="alert"]')) || null,
        12,
      );
      return { label: textOf(button), failure: failure ?? '', rejections: rejections() };
    },
    'popup:close': async () => {
      const tabId = open?.tabId;
      open = null;
      if (tabId !== undefined) await browser.tabs.remove(tabId);
      return { closed: tabId !== undefined };
    },
  };
}
