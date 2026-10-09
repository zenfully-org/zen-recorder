const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A position in the recording as `H:MM:SS`, always with hours, floored to the second (a player
 * seeking there shows what happened at that second or just after it).
 */
export function formatMediaOffset(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  return `${hours}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
