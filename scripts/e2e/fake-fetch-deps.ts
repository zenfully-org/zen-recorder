/**
 * A stand-in for the network and the clock of `fetchWithRetries`, for its tests and its callers':
 * `fetch` gives the answers in order (an error is a rejection, the way Node.js's `fetch` fails),
 * `wait` returns at once, and every call is written to `events` in the order it came.
 */
import type { FetchWithRetriesDeps } from './fetch-with-retries';

export interface FakeFetchDeps extends FetchWithRetriesDeps {
  /** What happened, in order: `fetch <method> <url>`, `warn <line>`, `wait <ms>`. */
  events: string[];
}

export function createFakeFetchDeps(answers: ReadonlyArray<Response | Error>): FakeFetchDeps {
  const events: string[] = [];
  let next = 0;
  return {
    events,
    fetch: (url, init) => {
      events.push(`fetch ${init.method ?? 'GET'} ${url}`);
      const answer = answers[next];
      next += 1;
      if (answer === undefined) throw new Error(`the test gave no answer for call ${next}`);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    wait: (ms) => {
      events.push(`wait ${ms}`);
      return Promise.resolve();
    },
    warn: (line) => {
      events.push(`warn ${line}`);
    },
  };
}

/** What Node.js's `fetch` rejects with on a network fault: "fetch failed", the reason in its cause. */
export function fetchFailed(code: string, message: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
}
