const UNITS = ['kB', 'MB', 'GB'] as const;

/** A file's size as a file manager lists it: decimal units, one decimal, "999 bytes" below 1 kB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  let value = bytes / 1000;
  let unit = 0;
  // Change unit once the size would round to 1000 of this one.
  while (Math.round(value * 10) >= 10_000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}
