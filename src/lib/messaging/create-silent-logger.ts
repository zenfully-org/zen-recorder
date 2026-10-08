/** No-op logger for @webext-core/messaging (its default prints every message to the console). */
export function createSilentLogger(): {
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
} {
  const noop = (): void => undefined;
  return { debug: noop, log: noop, warn: noop, error: noop };
}
