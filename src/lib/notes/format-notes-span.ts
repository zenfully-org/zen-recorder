/**
 * A length of time for a person to read: `3 s`, `2 min`, `1 min 30 s`, `1 h 5 min`. Floored to
 * the second; a position in the file is `formatMediaOffset` instead.
 */
export function formatNotesSpan(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}
