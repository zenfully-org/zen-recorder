import { defineExtensionMessaging } from '@webext-core/messaging';
import { createSilentLogger } from '@/lib/messaging/create-silent-logger';
import type { ExtensionProtocolMap } from '@/lib/types';

type ExtensionMessaging = ReturnType<typeof defineExtensionMessaging<ExtensionProtocolMap>>;

let messaging: ExtensionMessaging | null = null;

/** Typed request/response messaging between popup/options pages and the background. */
export function getExtensionMessaging(): ExtensionMessaging {
  messaging ??= defineExtensionMessaging<ExtensionProtocolMap>({ logger: createSilentLogger() });
  return messaging;
}
