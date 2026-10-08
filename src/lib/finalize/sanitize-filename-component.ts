/**
 * Firefox's downloads API refuses a name its own sanitizer would change, and the save fails
 * (`ext-downloads.js` runs `DownloadPaths.sanitize`, Gecko's `SanitizeFileName`, on each path
 * component). What it would change is removed here first.
 */
// Become a space: path separators, characters Windows forbids, and controls (C0, DEL, C1).
const ILLEGAL_RE = /[<>:"/\\|?*\p{Cc}]/gu;
// Dropped: invisible format characters (zero-width joiner, bidi marks, soft hyphen, zero-width
// space, byte order mark, tag characters…) and lone surrogates. The emoji around a joiner stay.
const INVISIBLE_RE = /[\p{Cf}\p{Cs}]/gu;
// A path component may not start or end with a space or a dot.
const ENDS_RE = /^[ .]+|[ .]+$/g;
// Windows device names, alone or before a dot (`con.notes` is `CON` too).
const RESERVED_WINDOWS_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$)(?:\.|$)/i;
const MAX_CHARACTERS = 80;
// ext4 takes 255 bytes per name and Firefox writes `<name>.part` while it downloads: this leaves
// room for ` (recovered) raw`, `(9999)` from uniquify, the extension and `.part`.
const MAX_BYTES = 200;

/** UTF-8 length of one code point (one UTF-16 unit, or a surrogate pair). */
function utf8Length(codePoint: string): number {
  if (codePoint.length > 1) return 4;
  const unit = codePoint.charCodeAt(0);
  return unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
}

/** The longest prefix within both limits, cut between two code points. */
function truncate(text: string): string {
  let out = '';
  let characters = 0;
  let bytes = 0;
  for (const codePoint of text) {
    characters += 1;
    bytes += utf8Length(codePoint);
    if (characters > MAX_CHARACTERS || bytes > MAX_BYTES) break;
    out += codePoint;
  }
  return out;
}

/** Makes a string safe as a single Windows/macOS/Linux path component (downloads API rules). */
export function sanitizeFilenameComponent(input: string, fallback = 'recording'): string {
  const cleaned = input
    .replace(INVISIBLE_RE, '')
    .replace(ILLEGAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(ENDS_RE, '');
  const out = truncate(cleaned).replace(ENDS_RE, '');
  if (out.length === 0 || RESERVED_WINDOWS_RE.test(out)) return fallback;
  return out;
}
