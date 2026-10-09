import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * How long loading every entrypoint once may take. Vitest transforms each module the first time a
 * test imports it, and that is most of the time: about 1 s for the whole extension when the
 * machine is idle, about 30 s on one CPU shared with 20 busy processes, and 50 s with 30.
 */
const TRANSFORM_BUDGET_MS = 120_000;

/** The popup and the Options page render as soon as they load; only what they load matters here. */
function stubPageRendering(): void {
  document.body.innerHTML = '<div id="root"></div>';
  vi.doMock('react-dom/client', () => ({ createRoot: () => ({ render: () => undefined }) }));
}

function restorePageRendering(): void {
  document.body.innerHTML = '';
  vi.doUnmock('react-dom/client');
}

describe('every entrypoint', () => {
  /** What zod passed to the browser's `Function` constructor while the entrypoint loaded. */
  let compiled: unknown[][];
  /** The entrypoint the test loads: a load that outlives its test must not reach the next one. */
  let loading: Promise<unknown> | undefined;

  // Each module is transformed once, here, with a budget for it: the tests then load modules
  // Vitest already has, and each one takes as long as evaluating its own module graph. zod stays
  // interpreted meanwhile: it asks whether it may compile code only once per process, and that one
  // question is what a test's trap has to see.
  beforeAll(async () => {
    z.config({ jitless: true });
    stubPageRendering();
    for (const [, load] of ENTRYPOINTS) await load();
    restorePageRendering();
  }, TRANSFORM_BUDGET_MS);

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
    stubPageRendering();
  });

  afterEach(async () => {
    // A load that timed out goes on: it would build its schemas, and maybe ask for compiled code,
    // under the next test's trap. The next test starts once it has settled.
    await loading?.catch(() => undefined);
    loading = undefined;
    globalThis.Function = browserFunction;
    restorePageRendering();
  }, TRANSFORM_BUDGET_MS);

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
      loading = load();
      await loading;

      expect(compiled).toEqual([]);
      expect(z.config().jitless).toBe(true);
    },
  );
});
