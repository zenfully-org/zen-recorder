import { z } from 'zod';

/** What the recorder and the bridge use of a `MessagePort`. */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
}

const METHODS = [
  'postMessage',
  'start',
  'close',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
] as const;

/** Checks the methods, and keeps the port itself: a copy would lose them. */
const portSchema = z.custom<MessagePortLike>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    METHODS.every((method) => typeof Reflect.get(value, method) === 'function'),
);

/**
 * The port a bridge hands the page in its connect event; null when the event carries something
 * else. The page's own scripts can dispatch that event too, with anything in it.
 */
export function parseMessagePort(value: unknown): MessagePortLike | null {
  const parsed = portSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
