/** The tab's title at `/<code>`: `<meeting> - Google Meet`. */
const TITLE_SUFFIX_RE = /\s*[-–—]\s*Google Meet\s*$/i;
/** The tab's title at `/meet/<code>`: `Meet: <meeting>`, the same in every UI language. */
const TITLE_PREFIX_RE = /^\s*Meet:/;

/**
 * The meeting's name from the tab's title, without Meet's suffix or, when there is none, its
 * prefix (a meeting named `Meet: …` keeps the name under the suffix); falls back to the meeting
 * code for empty/generic titles.
 */
export function meetingTitleFromDocumentTitle(title: string, meetingCode: string | null): string {
  const name = TITLE_SUFFIX_RE.test(title)
    ? title.replace(TITLE_SUFFIX_RE, '')
    : title.replace(TITLE_PREFIX_RE, '');
  const cleaned = name.trim();
  if (cleaned.length === 0 || cleaned.toLowerCase() === 'meet') return meetingCode ?? 'meeting';
  return cleaned;
}
