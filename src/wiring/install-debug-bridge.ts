/**
 * Test builds only: lets a script in the page (the end-to-end run, or the console of a browser
 * driven by hand) run background diagnostics via
 * `window.postMessage({ type: 'zen-recorder:debug-probe', name })`; the result comes back as
 * `{ type: 'zen-recorder:debug-probe-result', name, result }`. A name in `local` is the bridge's
 * own probe and never reaches the background. The bridge calls it behind
 * `import.meta.env.WXT_E2E === '1'`, so a release build leaves it out.
 */
import { z } from 'zod';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';

export function installDebugBridge(
  signal: AbortSignal,
  local: ReadonlyMap<string, () => unknown>,
): void {
  // Built here, not when the module loads: nothing of this module runs in a build that never
  // calls it, so the bundler can leave all of it out.
  const requestSchema = z.object({
    type: z.literal('zen-recorder:debug-probe'),
    name: z.string().default(''),
  });
  window.addEventListener(
    'message',
    (event) => {
      const request = requestSchema.safeParse(event.data);
      if (event.source !== window || !request.success) return;
      const { name } = request.data;
      const own = local.get(name);
      void (
        own ? Promise.resolve(own()) : getExtensionMessaging().sendMessage('debugProbe', { name })
      )
        .catch((error: unknown) => ({ error: String(error) }))
        .then((result) =>
          window.postMessage({ type: 'zen-recorder:debug-probe-result', name, result }, '*'),
        );
    },
    { signal },
  );
}
