// @vitest-environment node
import { createFakeFetchDeps, fetchFailed } from './fake-fetch-deps';
import { type AttemptResult, fetchWithRetries } from './fetch-with-retries';

const ADDRESS =
  'https://download-installer.cdn.mozilla.net/pub/firefox/releases/159.0.1/linux-x86_64/en-US/firefox-159.0.1.tar.xz';
const FETCH = `fetch GET ${ADDRESS}`;
const RESET = fetchFailed('ECONNRESET', 'read ECONNRESET');
const TIMEOUT = fetchFailed(
  'UND_ERR_CONNECT_TIMEOUT',
  'Connect Timeout Error (attempted address: download-installer.cdn.mozilla.net:443, timeout: 10000ms)',
);
const TIMEOUT_REASON =
  'fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (attempted address: download-installer.cdn.mozilla.net:443, timeout: 10000ms))';

/** Takes any answer that gets this far, by its text. */
const readText = async (response: Response): Promise<AttemptResult<string>> => ({
  ok: true,
  value: await response.text(),
});

/** Refuses every answer that gets this far, as a fault no later attempt changes. */
const refuse = async (response: Response): Promise<AttemptResult<string>> => ({
  ok: false,
  passing: false,
  reason: `HTTP ${response.status}`,
});

/** An answer whose body breaks off: the socket closed while it was read. */
const droppedBody = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(
          new TypeError('terminated', {
            cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
          }),
        );
      },
    }),
  );

describe('fetchWithRetries', () => {
  it('returns what the first answer reads to, without waiting', async () => {
    const deps = createFakeFetchDeps([new Response('firefox')]);

    await expect(fetchWithRetries(ADDRESS, { method: 'HEAD' }, readText, deps)).resolves.toBe(
      'firefox',
    );
    expect(deps.events).toEqual([`fetch HEAD ${ADDRESS}`]);
  });

  it.each([500, 502, 503, 504, 408, 429])(
    'tries again 3 s after a server answers HTTP %i',
    async (status) => {
      const deps = createFakeFetchDeps([new Response('busy', { status }), new Response('firefox')]);

      await expect(fetchWithRetries(ADDRESS, {}, readText, deps)).resolves.toBe('firefox');
      expect(deps.events).toEqual([
        FETCH,
        `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: HTTP ${status}`,
        'wait 3000',
        FETCH,
      ]);
    },
  );

  it('tries again after a dropped connection, naming its cause', async () => {
    const deps = createFakeFetchDeps([RESET, new Response('firefox')]);

    await expect(fetchWithRetries(ADDRESS, {}, readText, deps)).resolves.toBe('firefox');
    expect(deps.events).toEqual([
      FETCH,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: fetch failed (read ECONNRESET)`,
      'wait 3000',
      FETCH,
    ]);
  });

  it('tries again when the connection drops while the body is read', async () => {
    const deps = createFakeFetchDeps([droppedBody(), new Response('firefox')]);

    await expect(fetchWithRetries(ADDRESS, {}, readText, deps)).resolves.toBe('firefox');
    expect(deps.events).toEqual([
      FETCH,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: terminated (UND_ERR_SOCKET: other side closed)`,
      'wait 3000',
      FETCH,
    ]);
  });

  it('tries again when reading the answer finds a fault that can pass', async () => {
    const readWhole = async (response: Response): Promise<AttemptResult<string>> => {
      const text = await response.text();
      return text === 'fire'
        ? { ok: false, passing: true, reason: 'cut short' }
        : { ok: true, value: text };
    };
    const deps = createFakeFetchDeps([new Response('fire'), new Response('firefox')]);

    await expect(fetchWithRetries(ADDRESS, {}, readWhole, deps)).resolves.toBe('firefox');
    expect(deps.events).toEqual([
      FETCH,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: cut short`,
      'wait 3000',
      FETCH,
    ]);
  });

  it('fails at once when reading the answer finds a fault no attempt changes', async () => {
    const deps = createFakeFetchDeps([new Response('', { status: 404 })]);

    await expect(fetchWithRetries(ADDRESS, {}, refuse, deps)).rejects.toThrow(
      new Error(`${ADDRESS}: HTTP 404`),
    );
    expect(deps.events).toEqual([FETCH]);
  });

  it('stops trying at a fault no attempt changes, after one that could pass', async () => {
    const deps = createFakeFetchDeps([RESET, new Response('', { status: 404 })]);

    await expect(fetchWithRetries(ADDRESS, {}, refuse, deps)).rejects.toThrow(
      new Error(`${ADDRESS}: HTTP 404`),
    );
    expect(deps.events).toEqual([
      FETCH,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: fetch failed (read ECONNRESET)`,
      'wait 3000',
      FETCH,
    ]);
  });

  it('gives up after the third attempt, with the address and the last cause', async () => {
    const deps = createFakeFetchDeps([RESET, TIMEOUT, TIMEOUT]);

    await expect(fetchWithRetries(ADDRESS, {}, readText, deps)).rejects.toThrow(
      new Error(`attempt 3 of 3 failed: ${ADDRESS}: ${TIMEOUT_REASON}`),
    );
    expect(deps.events).toEqual([
      FETCH,
      `warn attempt 1 of 3 failed, trying again in 3 s: ${ADDRESS}: fetch failed (read ECONNRESET)`,
      'wait 3000',
      FETCH,
      `warn attempt 2 of 3 failed, trying again in 6 s: ${ADDRESS}: ${TIMEOUT_REASON}`,
      'wait 6000',
      FETCH,
    ]);
  });
});
