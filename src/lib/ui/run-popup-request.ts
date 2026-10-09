/**
 * Makes one of the popup's requests to the browser and resolves with what to tell the person when
 * it fails: `whatFailed` and the reason ("Could not open the settings: …"), or `null` when it went
 * through. A failed click is never silent.
 *
 * The request is made at once, before anything is awaited: Firefox runs `permissions.request` only
 * while the page handles the person's input, so the click handler must reach it synchronously.
 */
export function runPopupRequest(
  whatFailed: string,
  request: () => Promise<unknown>,
): Promise<string | null> {
  let pending: Promise<unknown>;
  try {
    pending = request();
  } catch (error) {
    pending = Promise.reject(error);
  }
  return pending.then(
    () => null,
    (error: unknown) => `${whatFailed}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
