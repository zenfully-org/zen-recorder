import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Every bundle of the extension, by its entrypoint: the scripts directly in `src/entrypoints/`
 * and the `main.tsx` of each page. Each one must leave zod in its interpreted mode before any of
 * its schemas is built: zod asks the browser whether it may compile code (`new Function('')`)
 * when it builds its first object schema, and a meeting page whose CSP forbids eval sees that
 * attempt and can report it to the service.
 */
const ENTRYPOINTS = Object.entries(
  import.meta.glob(['/src/entrypoints/*.ts', '/src/entrypoints/*/main.tsx']),
).map(([file, load]): [string, () => Promise<unknown>] => [
  file.replace('/src/entrypoints/', ''),
  load,
]);

const browserFunction = globalThis.Function;

describe('every entrypoint', () => {
  /** What zod passed to the browser's `Function` constructor while the entrypoint loaded. */
  let compiled: unknown[][];

  beforeEach(() => {
    // Each entrypoint loads its whole module graph again, with zod back in its default mode.
    vi.resetModules();
    z.config({ jitless: false });
    compiled = [];
    globalThis.Function = new Proxy(browserFunction, {
      construct(target, args, newTarget) {
        compiled.push(args);
        return Reflect.construct(target, args, newTarget);
      },
    });
    // The popup and the Options page render as soon as they load; only what they load matters here.
    document.body.innerHTML = '<div id="root"></div>';
    vi.doMock('react-dom/client', () => ({ createRoot: () => ({ render: () => undefined }) }));
  });

  afterEach(() => {
    globalThis.Function = browserFunction;
    document.body.innerHTML = '';
    vi.doUnmock('react-dom/client');
  });

  it('are found: the content scripts, the background and the pages', () => {
    expect(ENTRYPOINTS.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'meet-hook.content.ts',
        'meet.content.ts',
        'zoom-hook.content.ts',
        'zoom.content.ts',
        'teams-hook.content.ts',
        'teams.content.ts',
        'background.ts',
        'popup/main.tsx',
        'options/main.tsx',
      ]),
    );
  });

  it.each(ENTRYPOINTS)(
    '%s builds its schemas without asking the browser to compile code',
    async (_name, load) => {
      await load();

      expect(compiled).toEqual([]);
      expect(z.config().jitless).toBe(true);
    },
  );
});
