import { afterEach, describe, expect, it } from 'vitest';
import { offerTapModule } from './offer-tap-module';

const NS = 'test-ns';
const URL_OF_FILE = 'moz-extension://4f1c9b3e-0000-4000-8000-000000000000/audio-tap-worklet-0.js';

/** The recorder's side, as `receiveTapModule` behaves: it takes the first offer it hears. */
function listenAsRecorder(): string[] {
  const taken: string[] = [];
  window.addEventListener(`${NS}:tap-module`, function take(event) {
    if (!('detail' in event) || typeof event.detail !== 'string') return;
    taken.push(event.detail);
    event.preventDefault();
    window.removeEventListener(`${NS}:tap-module`, take);
  });
  return taken;
}

/** A listener of the page, which must never hear the URL. */
function listenAsPage(): string[] {
  const heard: string[] = [];
  window.addEventListener(`${NS}:tap-module`, (event) => {
    if ('detail' in event) heard.push(String(event.detail));
  });
  return heard;
}

const askAsRecorder = () => window.dispatchEvent(new CustomEvent(`${NS}:tap-module-wanted`));

/** A document at document_start: the root element and nothing in it. */
function freshDocument(): void {
  document.documentElement.replaceChildren();
  Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
}

describe('offerTapModule', () => {
  afterEach(() => {
    document.documentElement.replaceChildren(
      document.createElement('head'),
      document.createElement('body'),
    );
    Reflect.deleteProperty(document, 'readyState');
  });

  it('hands the URL to a recorder already listening, at once', () => {
    freshDocument();
    const taken = listenAsRecorder();
    offerTapModule(window, NS, URL_OF_FILE);
    expect(taken).toEqual([URL_OF_FILE]);
    // Taken: the bridge answers nobody after it.
    const heard = listenAsPage();
    askAsRecorder();
    expect(heard).toEqual([]);
  });

  it('waits for a recorder that comes later in the same document_start, and answers it once', () => {
    freshDocument();
    offerTapModule(window, NS, URL_OF_FILE);
    const taken = listenAsRecorder();
    askAsRecorder();
    expect(taken).toEqual([URL_OF_FILE]);
    const heard = listenAsPage();
    askAsRecorder();
    expect(heard).toEqual([]);
  });

  it('answers no request once the page has more than its root element: its scripts may run', () => {
    freshDocument();
    offerTapModule(window, NS, URL_OF_FILE);
    document.documentElement.append(document.createElement('head'));
    const heard = listenAsPage();
    askAsRecorder();
    askAsRecorder();
    expect(heard).toEqual([]);
  });

  it.each([
    // An extension reload or update injects the bridge into a page that runs its scripts already.
    ['a document that is loaded', 'complete', true],
    ['a document that is still loading but has its elements', 'loading', false],
  ])('offers nothing in %s', (_label, readyState, empty) => {
    if (empty) document.documentElement.replaceChildren();
    Object.defineProperty(document, 'readyState', { value: readyState, configurable: true });
    const heard = listenAsPage();
    offerTapModule(window, NS, URL_OF_FILE);
    askAsRecorder();
    expect(heard).toEqual([]);
  });
});
