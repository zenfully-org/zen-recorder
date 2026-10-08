const TITLE_SUFFIX_RE = /\s*[-–—]\s*Google Meet\s*$/i;

/** Strips the " - Google Meet" suffix; falls back to the meeting code for empty/generic titles. */
export function meetingTitleFromDocumentTitle(title: string, meetingCode: string | null): string {
  const cleaned = title.replace(TITLE_SUFFIX_RE, '').trim();
  if (cleaned.length === 0 || cleaned.toLowerCase() === 'meet') return meetingCode ?? 'meeting';
  return cleaned;
}
