/**
 * The bytes of a file, fetched with `fetchWithRetries`: an answer cut short (fewer bytes than its
 * `content-length` announced) is downloaded again, an HTTP error status fails at once. A
 * compressed answer is not measured: `fetch` hands over its bytes decoded, and its
 * `content-length` counts them encoded.
 */
import { type FetchWithRetriesDeps, fetchWithRetries } from './fetch-with-retries';

export function downloadFile(url: string, deps: FetchWithRetriesDeps): Promise<Uint8Array> {
  return fetchWithRetries(
    url,
    {},
    async (response) => {
      if (!response.ok) return { ok: false, passing: false, reason: `HTTP ${response.status}` };
      const bytes = new Uint8Array(await response.arrayBuffer());
      const announced = announcedLength(response.headers);
      return announced !== null && bytes.byteLength < announced
        ? {
            ok: false,
            passing: true,
            reason: `cut short, ${bytes.byteLength} of ${announced} bytes`,
          }
        : { ok: true, value: bytes };
    },
    deps,
  );
}

function announcedLength(headers: Headers): number | null {
  const length = headers.get('content-length');
  const encoding = headers.get('content-encoding') ?? 'identity';
  return length === null || encoding !== 'identity' ? null : Number(length);
}
