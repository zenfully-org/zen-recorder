/**
 * Whether a new `AudioContext` would start now, by the browser's autoplay policy. Firefox keeps a
 * context suspended, and warns in the page's console, while the page may not play audio: until a
 * click or key press in it, unless it captures the microphone, camera or screen or the site may
 * autoplay. `navigator.getAutoplayPolicy('audiocontext')` (Autoplay Policy Detection) answers that
 * check. Not in TypeScript's DOM types, so it is read and its answer validated here; when the
 * browser cannot say, the context is tried.
 */
import { parseAutoplayPolicy } from '@/lib/protocol/parse-autoplay-policy';

export function canStartAudioContext(navigator: object): boolean {
  const getAutoplayPolicy: unknown = Reflect.get(navigator, 'getAutoplayPolicy');
  if (typeof getAutoplayPolicy !== 'function') return true;
  const policy = parseAutoplayPolicy(Reflect.apply(getAutoplayPolicy, navigator, ['audiocontext']));
  return policy === null || policy === 'allowed';
}
