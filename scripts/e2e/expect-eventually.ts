/**
 * Checks a value that reaches its expected state a moment after something the scenario can see,
 * like a recording's stored status: the file is complete on disk first, and the background marks
 * the recording `saved` once it has seen the download complete and written that down. Reads until
 * the value is the expected one (for 10 s by default), and fails, like `expectEqual`, with the
 * last value it read.
 */
export async function expectEventually<T>(
  label: string,
  read: () => Promise<T>,
  expected: T,
  timeoutMs = 10_000,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let actual = await read();
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    actual = await read();
  }
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)} within ${timeoutMs / 1000} s`,
    );
  }
}
