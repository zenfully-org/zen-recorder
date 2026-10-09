import { afterEach, describe, expect, it } from 'vitest';
import { receiveTapModule } from './receive-tap-module';

const NS = 'test-ns';
const FILE = 'audio-tap-worklet-0a1b2c3d.js';
const URL_OF_FILE = `moz-extension://4f1c9b3e-0000-4000-8000-000000000000/${FILE}`;

/** Offers `detail` as the bridge does; true when the recorder took it (cancelled the event). */
const offer = (detail: unknown) =>
  !window.dispatchEvent(new CustomEvent(`${NS}:tap-module`, { detail, cancelable: true }));

describe('receiveTapModule', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it('asks the bridge at once, and takes the URL it is offered then', () => {
    const answer = () => offer(URL_OF_FILE);
    window.addEventListener(`${NS}:tap-module-wanted`, answer);
    stops.push(() => window.removeEventListener(`${NS}:tap-module-wanted`, answer));
    const moduleFile = receiveTapModule(window, NS, FILE);
    expect(moduleFile()).toBe(URL_OF_FILE);
  });

  it('takes an offer made after it asked, cancelling it, and none after it', () => {
    const moduleFile = receiveTapModule(window, NS, FILE);
    expect(moduleFile()).toBeNull();
    expect(offer(URL_OF_FILE)).toBe(true);
    expect(offer(URL_OF_FILE.replace('4f1c', '9999'))).toBe(false);
    expect(moduleFile()).toBe(URL_OF_FILE);
  });

  it('leaves alone an event of that name that carries nothing', () => {
    const moduleFile = receiveTapModule(window, NS, FILE);
    expect(window.dispatchEvent(new Event(`${NS}:tap-module`, { cancelable: true }))).toBe(true);
    expect(moduleFile()).toBeNull();
    expect(offer(URL_OF_FILE)).toBe(true);
  });

  it.each([
    ['another file of the extension', URL_OF_FILE.replace(FILE, 'popup.html')],
    ['the file of another build', URL_OF_FILE.replace('0a1b2c3d', '00000000')],
    ['a web URL', `https://example.org/${FILE}`],
    ['a blob URL', `blob:https://teams.microsoft.com/${FILE}`],
    ['a file name only, with a dot that is not one', FILE.replace('.js', 'xjs')],
    ['something else than text', { url: URL_OF_FILE }],
  ])('leaves alone an offer of %s and keeps waiting', (_label, detail) => {
    const moduleFile = receiveTapModule(window, NS, FILE);
    expect(offer(detail)).toBe(false);
    expect(moduleFile()).toBeNull();
    expect(offer(URL_OF_FILE)).toBe(true);
    expect(moduleFile()).toBe(URL_OF_FILE);
  });
});
