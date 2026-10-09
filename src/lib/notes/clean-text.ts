/**
 * Text from a meeting page (a name, a title) made safe to write anywhere in a notes file: well
 * formed, on one line, and reading as it shows. Drops controls (whitespace ones, NEL, the line and
 * paragraph separators become a space), DEL and C1, and the format characters that change how a
 * name reads or hide in it: bidi marks, embeddings, overrides and isolates, U+FEFF and the
 * noncharacters U+FFFE and U+FFFF. Keeps ZWJ and ZWNJ, which emoji and many scripts need. Collapses
 * whitespace and trims.
 */

/** Code point ranges dropped, all in the Basic Multilingual Plane. */
const DROPPED: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0e, 0x1f],
  [0x7f, 0x84],
  [0x86, 0x9f],
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfffe, 0xffff],
];

const kept = (char: string): boolean => {
  // Every dropped code point is a single UTF-16 unit; an astral character starts with a surrogate.
  const code = char.charCodeAt(0);
  return !DROPPED.some(([from, to]) => code >= from && code <= to);
};

export function cleanText(text: string): string {
  return [...text.toWellFormed()]
    .filter(kept)
    .join('')
    .replace(/[\s\u0085]+/g, ' ')
    .trim();
}
