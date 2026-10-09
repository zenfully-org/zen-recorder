/**
 * ISOLATED-world wiring shared by every provider's `*.content.ts`: connects browser APIs and the
 * DOM to the (tested) bridge function. Covered by the e2e run.
 */
import { z } from 'zod';
import { browser, type ContentScriptContext, createShadowRootUi } from '#imports';
import { createBridge } from '@/lib/bridge/create-bridge';
import { offerTapModule } from '@/lib/bridge/offer-tap-module';
import { getAddOnId } from '@/lib/get-add-on-id';
import { createBridgePort } from '@/lib/messaging/create-bridge-port';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { audioTapWorklet } from '@/lib/page/audio-tap-worklet';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { getProviderCatalog } from '@/lib/providers/get-provider-catalog';
import { ownsPage } from '@/lib/providers/owns-page';
import type { ProviderDescriptor } from '@/lib/providers/types';
import { getSettingsItem } from '@/lib/settings/get-settings-item';
import { loadSettings } from '@/lib/settings/load-settings';
import { parseSettings } from '@/lib/settings/parse-settings';
import type { LifecycleCommand, ProviderId } from '@/lib/types';
import { guardOverlayKeys } from '@/lib/ui/guard-overlay-keys';
import { loadOverlayPosition } from '@/lib/ui/load-overlay-position';
import { mountOverlay, type OverlayHandle } from '@/lib/ui/mount-overlay';
import { saveOverlayPosition } from '@/lib/ui/save-overlay-position';
import { exposeStatusCard } from '@/wiring/expose-status-card';

export interface BridgeOptions {
  descriptor: ProviderDescriptor;
  /** Which frames get a bridge. Must agree with the page recorder. Default: the top frame only. */
  shouldRun?: (win: Window) => boolean;
}

const isTopFrame = (win: Window): boolean => win === win.top;
const PREFIX = '[zen-recorder]';
/** The status card's host element, which holds its shadow root. */
const CARD = 'zen-recorder-overlay';

export async function runBridge(ctx: ContentScriptContext, options: BridgeOptions): Promise<void> {
  if (!(options.shouldRun ?? isTopFrame)(window)) return;
  if (!ownsPage(options.descriptor, window.location, getProviderCatalog())) return;
  let ui: Awaited<ReturnType<typeof mountStatusCard>> | null = null;
  // Now, at document_start, before any script of the page: it hears the card's keys first.
  const stopGuardingKeys = guardOverlayKeys(window, CARD, () => ui?.mounted?.collapse());
  // Now too, for the same reason: the worklet's URL names the extension's per-install id.
  offerTapModule(
    window,
    getAddOnId(),
    new URL(audioTapWorklet().file, browser.runtime.getURL('/')).href,
  );
  const instance = Math.random().toString(36).slice(2, 8);
  // The instance id tells reloads apart in the console (the page session outlives them).
  console.info(
    PREFIX,
    `bridge ${instance} starting on ${options.descriptor.label} (${browser.runtime.getManifest().version})`,
  );
  /**
   * Test builds turn it off to make the tab die like a crashed one: no `pagehide` end, and no
   * handover from the page either.
   */
  let endOnPageHide = true;
  const messenger = createPageMessenger(window);
  const bridge = createBridge({
    messenger: {
      ...messenger,
      onSync: (type, handler) =>
        messenger.onSync(type, (message) => {
          if (endOnPageHide) handler(message);
        }),
    },
    createPort: (onMessage) =>
      createBridgePort({
        connect: (info) => browser.runtime.connect(info),
        onMessage,
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (id) => window.clearInterval(id),
        bridgeId: crypto.randomUUID(),
      }),
    loadSettings,
    watchSettings: (listener) => getSettingsItem().watch((value) => listener(parseSettings(value))),
    onPageHide: (listener) => {
      const onPageHide = () => {
        if (endOnPageHide) listener();
      };
      window.addEventListener('pagehide', onPageHide);
      return () => window.removeEventListener('pagehide', onPageHide);
    },
    mountOverlay: async (onCommand) => {
      const shadowUi = await mountStatusCard(ctx, options.descriptor.id, onCommand);
      ui = shadowUi;
      return shadowUi.mounted ?? null;
    },
    setInterval: (handler, ms) => ctx.setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id),
    log: {
      info: (m) => console.info(PREFIX, `[${instance}]`, m),
      warn: (m) => console.warn(PREFIX, m),
      error: (m) => console.error(PREFIX, m),
    },
  });
  ctx.onInvalidated(() => {
    bridge.dispose();
    stopGuardingKeys();
    // Otherwise the reloaded extension mounts a second card next to the orphaned old one.
    ui?.remove();
  });
  if (import.meta.env['WXT_E2E'] === '1') {
    installDebugBridge(
      ctx.signal,
      new Map([
        [
          'bridge:no-pagehide-end',
          () => {
            endOnPageHide = false;
            return { endOnPageHide };
          },
        ],
      ]),
    );
  }
  await bridge.start();
}

/**
 * Mounts the status card once the page has a body, where the person left it on this service, and
 * remembers where they drag it next.
 */
async function mountStatusCard(
  ctx: ContentScriptContext,
  provider: ProviderId,
  onCommand: (command: LifecycleCommand) => void,
) {
  if (!document.body) {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
    );
  }
  // Firefox tears the previous content-script context down without running its cleanup when the
  // extension reloads, so a card from the previous load may still be in the DOM.
  for (const stale of document.querySelectorAll(CARD)) stale.remove();
  const warn = (what: string) => (error: unknown) =>
    console.warn(PREFIX, `could not ${what} where the status card was left: ${String(error)}`);
  const position = await loadOverlayPosition(provider).catch((error: unknown) => {
    warn('read')(error);
    return null;
  });
  const shadowUi = await createShadowRootUi<OverlayHandle>(ctx, {
    name: CARD,
    // Closed: the page's scripts share the DOM, and an open root would let them read what the
    // card says (recording or not, for how long, what failed). The bridge keeps the root itself.
    mode: 'closed',
    position: 'overlay',
    anchor: 'body',
    append: 'last',
    onMount: (_container, shadow) => {
      if (import.meta.env['WXT_E2E'] === '1') exposeStatusCard(window, shadow);
      return mountOverlay(shadow, {
        onCommand,
        position,
        onPositionChange: (next) =>
          void saveOverlayPosition(provider, next).catch(warn('remember')),
        // The area a fixed element is placed in: the window without its scrollbars.
        viewport: () => ({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        }),
        onViewportResize: (listener) => {
          window.addEventListener('resize', listener);
          return () => window.removeEventListener('resize', listener);
        },
      });
    },
    onRemove: (handle) => handle?.destroy(),
  });
  shadowUi.mount();
  return shadowUi;
}

const debugProbeSchema = z.object({
  type: z.literal('zen-recorder:debug-probe'),
  name: z.string().default(''),
});

/**
 * Test-build only: lets a script in the page (the end-to-end run, or the console of a browser
 * driven by hand) run background diagnostics via
 * `window.postMessage({ type: 'zen-recorder:debug-probe', name })`; the result comes back as
 * `{ type: 'zen-recorder:debug-probe-result', name, result }`. A name in `local` is the bridge's
 * own probe and never reaches the background.
 */
function installDebugBridge(signal: AbortSignal, local: ReadonlyMap<string, () => unknown>): void {
  window.addEventListener(
    'message',
    (event) => {
      const request = debugProbeSchema.safeParse(event.data);
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
