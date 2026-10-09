/**
 * Where a position the encoder counted is in the saved file: past the remux's start offset, never
 * before 0, and placed at the file's end, with `clamped`, when it is past it.
 */
export function placeInFile(
  mediaMs: number,
  file: { mediaOffsetMs: number; durationMs: number | null },
): { mediaMs: number; clamped?: true } {
  const inFile = Math.max(0, mediaMs - file.mediaOffsetMs);
  return file.durationMs !== null && inFile > file.durationMs
    ? { mediaMs: file.durationMs, clamped: true }
    : { mediaMs: inFile };
}
