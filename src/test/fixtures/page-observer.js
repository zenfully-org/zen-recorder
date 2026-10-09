// What a meeting page's own first script could see of the recorder, recorded for the end-to-end
// run (scenario 89). Every fake page loads it first; it does nothing unless the page's URL has
// `observe`. It replaces `AudioWorklet.prototype.addModule` and `EventTarget.prototype.dispatchEvent`
// as a page could, listens to every message the window gets and to the recorder's own event names
// (the add-on id is public), and `__observed.scan()` searches resource timing, the window's own
// properties and the DOM. Anything naming `moz-extension` is a leak: the extension's per-install id.
(() => {
  if (!new URLSearchParams(location.search).has('observe')) return;
  const NEEDLE = 'moz-extension';
  const NAMESPACE = 'zen-recorder@zenfully-org.github.io';
  const observed = { addModule: [], leaks: [] };
  window.__observed = observed;
  const check = (where, value) => {
    let text = '';
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    } catch {
      text = String(value);
    }
    if (text.includes(NEEDLE)) observed.leaks.push(`${where}: ${text.slice(0, 200)}`);
  };
  if (typeof AudioWorklet === 'function') {
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url, ...rest) {
      // The page's own calls come from its document; the recorder's frames show no URL.
      const fromPage = (new Error().stack ?? '').split('\n').slice(1).some((line) => line.includes(location.origin) && !line.includes('page-observer.js'));
      observed.addModule.push({ url: String(url), fromPage });
      check('addModule', url);
      return addModule.call(this, url, ...rest);
    };
  }
  const dispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if ('detail' in event) check(`dispatched ${event.type}`, event.detail);
    return dispatchEvent.call(this, event);
  };
  window.addEventListener('message', (event) => check('message', event.data), true);
  for (const type of ['tap-module', 'tap-module-wanted']) {
    window.addEventListener(`${NAMESPACE}:${type}`, (event) => check(`event ${event.type}`, event.detail), true);
  }
  observed.scan = () => {
    for (const entry of performance.getEntriesByType('resource')) check('resource timing', entry.name);
    for (const name of Object.getOwnPropertyNames(window)) {
      let value;
      try {
        value = window[name];
      } catch {
        continue;
      }
      if (typeof value === 'string') check(`window.${name}`, value);
    }
    check('the DOM', document.documentElement.outerHTML);
    return observed;
  };
})();
