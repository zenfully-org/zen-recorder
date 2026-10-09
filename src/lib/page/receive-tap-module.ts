/**
 * The page recorder's side of `offerTapModule`: at document_start it asks the bridge for the URL
 * of the audio tap's worklet file and takes the first offer that names that file in the extension,
 * cancelling the offer so the bridge knows it arrived. The offer crossed from the other world, so
 * it is checked: a `moz-extension:` URL of this build's worklet file, nothing else.
 */
import { z } from 'zod';

/** What the recorder needs of a window; the real one and the test double both have it. */
export interface TapModuleListenerWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  CustomEvent: typeof CustomEvent;
}

export function receiveTapModule(
  win: TapModuleListenerWindow,
  namespace: string,
  file: string,
): () => string | null {
  const offered = z
    .string()
    .regex(new RegExp(`^moz-extension://[0-9a-f-]+/${file.replaceAll('.', '\\.')}$`));
  let url: string | null = null;
  const type = `${namespace}:tap-module`;
  const onOffer = (event: Event) => {
    const parsed = offered.safeParse('detail' in event ? event.detail : undefined);
    if (!parsed.success) return;
    url = parsed.data;
    event.preventDefault();
    win.removeEventListener(type, onOffer);
  };
  win.addEventListener(type, onOffer);
  win.dispatchEvent(new win.CustomEvent(`${namespace}:tap-module-wanted`));
  return () => url;
}
