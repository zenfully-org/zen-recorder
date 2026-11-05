/**
 * Why a `fetch` failed, in one line. Node.js's `fetch` rejects with "fetch failed" whatever went
 * wrong and keeps the reason in the error's `cause`: a reset connection (`ECONNRESET`), a failed
 * DNS lookup (`ENOTFOUND`), a connect timeout (`UND_ERR_CONNECT_TIMEOUT`), a closed socket
 * (`UND_ERR_SOCKET`). Each cause follows in brackets, with its code when its message does not
 * already name it, so a log says whether the server, DNS or the machine's own network failed.
 */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  const message = messageOf(error);
  const head = code === null || message.includes(code) ? message : `${code}: ${message}`;
  return error.cause === undefined ? head : `${head} (${describeFetchError(error.cause)})`;
}

function messageOf(error: Error): string {
  if (error.message !== '') return error.message;
  // When no address of a host answers, Node.js rejects with one AggregateError without a message.
  if (error instanceof AggregateError) {
    return error.errors.map((inner: unknown) => describeFetchError(inner)).join('; ');
  }
  return error.name;
}
