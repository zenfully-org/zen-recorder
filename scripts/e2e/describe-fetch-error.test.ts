// @vitest-environment node
import { describeFetchError } from './describe-fetch-error';

/** An error carrying a system or undici code, the way Node.js reports a network fault. */
const withCode = (error: Error, code: string): Error => Object.assign(error, { code });

/** What Node.js's `fetch` rejects with: always "fetch failed", the reason in its cause. */
const fetchFailed = (cause: unknown): TypeError => new TypeError('fetch failed', { cause });

interface Case {
  name: string;
  error: unknown;
  want: string;
}

describe('describeFetchError', () => {
  it.each<Case>([
    {
      name: 'a connection the other side reset',
      error: fetchFailed(withCode(new Error('read ECONNRESET'), 'ECONNRESET')),
      want: 'fetch failed (read ECONNRESET)',
    },
    {
      name: 'a host DNS does not know',
      error: fetchFailed(
        withCode(new Error('getaddrinfo ENOTFOUND download.mozilla.org'), 'ENOTFOUND'),
      ),
      want: 'fetch failed (getaddrinfo ENOTFOUND download.mozilla.org)',
    },
    {
      name: 'a connection that timed out',
      error: fetchFailed(
        withCode(
          new Error(
            'Connect Timeout Error (attempted address: download-installer.cdn.mozilla.net:443, timeout: 10000ms)',
          ),
          'UND_ERR_CONNECT_TIMEOUT',
        ),
      ),
      want: 'fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (attempted address: download-installer.cdn.mozilla.net:443, timeout: 10000ms))',
    },
    {
      name: 'a body cut off by a closed socket',
      error: new TypeError('terminated', {
        cause: withCode(new Error('other side closed'), 'UND_ERR_SOCKET'),
      }),
      want: 'terminated (UND_ERR_SOCKET: other side closed)',
    },
    {
      name: 'every address of a host unreachable',
      error: fetchFailed(
        withCode(
          new AggregateError([
            withCode(new Error('connect ETIMEDOUT 192.0.2.1:443'), 'ETIMEDOUT'),
            withCode(new Error('connect ENETUNREACH 2001:db8::1:443'), 'ENETUNREACH'),
          ]),
          'ETIMEDOUT',
        ),
      ),
      want: 'fetch failed (connect ETIMEDOUT 192.0.2.1:443; connect ENETUNREACH 2001:db8::1:443)',
    },
    {
      name: 'a cause of a cause',
      error: fetchFailed(new Error('outer', { cause: new Error('inner') })),
      want: 'fetch failed (outer (inner))',
    },
    {
      name: 'a cause that is no error',
      error: fetchFailed('the proxy said no'),
      want: 'fetch failed (the proxy said no)',
    },
    {
      name: 'an error without a cause',
      error: new Error('unexpected redirect'),
      want: 'unexpected redirect',
    },
    {
      name: 'an error without a message',
      error: new RangeError(),
      want: 'RangeError',
    },
    { name: 'something thrown that is no error', error: 'boom', want: 'boom' },
  ])('describes $name', ({ error, want }) => {
    expect(describeFetchError(error)).toBe(want);
  });
});
