/**
 * Fetches an address and reads the answer, and tries again a few seconds later after a fault that
 * can pass: a dropped connection, a failed DNS lookup, a timeout, a server error (5xx), a server
 * asking to be called later (408, 429), or what `read` says can pass (an answer cut short). CI
 * downloads Firefox on many runners at once, and one dropped connection used to fail a whole job.
 * A fault no later attempt changes, as `read` judges it (a 404 for a release that is not there
 * yet), fails at once. `read` throws only what reading the body throws, which is the network's
 * fault too. Three attempts at most, 3 s and 6 s apart, so a fault that lasts fails the
 * job within seconds, with the address and the last cause in its message; every failed attempt
 * that will be tried again is written through `warn` with its cause.
 */
import { describeFetchError } from './describe-fetch-error';

/** What one attempt found: the value, or why it failed and whether another attempt may succeed. */
export type AttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; passing: boolean };

export interface FetchWithRetriesDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Resolves after `ms` milliseconds: the pause before the next attempt. */
  wait: (ms: number) => Promise<void>;
  /** Writes a line about an attempt that failed and will be tried again. */
  warn: (line: string) => void;
}

/** The pauses before the second and the third attempt. */
const PAUSES_MS = [3_000, 6_000];
const ATTEMPTS = PAUSES_MS.length + 1;
/** Request Timeout and Too Many Requests: the server itself asks to be called again later. */
const LATER = new Set([408, 429]);

export async function fetchWithRetries<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<AttemptResult<T>>,
  deps: FetchWithRetriesDeps,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await tryOnce(url, init, read, deps);
    if (result.ok) return result.value;
    if (!result.passing) throw new Error(`${url}: ${result.reason}`);
    const pause = PAUSES_MS[attempt - 1];
    if (pause === undefined) {
      throw new Error(`attempt ${attempt} of ${ATTEMPTS} failed: ${url}: ${result.reason}`);
    }
    deps.warn(
      `attempt ${attempt} of ${ATTEMPTS} failed, trying again in ${pause / 1000} s: ${url}: ${result.reason}`,
    );
    await deps.wait(pause);
  }
}

async function tryOnce<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<AttemptResult<T>>,
  deps: FetchWithRetriesDeps,
): Promise<AttemptResult<T>> {
  try {
    const response = await deps.fetch(url, init);
    if (response.status >= 500 || LATER.has(response.status)) {
      return { ok: false, reason: `HTTP ${response.status}`, passing: true };
    }
    return await read(response);
  } catch (error) {
    // `fetch` rejects, and reading a body throws, only when the network failed.
    return { ok: false, reason: describeFetchError(error), passing: true };
  }
}
