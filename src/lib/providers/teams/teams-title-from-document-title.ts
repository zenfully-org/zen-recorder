const SUFFIX_RE = /\s*\|\s*Microsoft Teams\s*$/i;
const GENERIC_TITLE = 'Microsoft Teams meeting';

/** Strips the " | Microsoft Teams" suffix of the tab title; never returns an empty title. */
export function teamsTitleFromDocumentTitle(title: string): string {
  const cleaned = title.replace(SUFFIX_RE, '').trim();
  return cleaned === '' || cleaned.toLowerCase() === 'microsoft teams' ? GENERIC_TITLE : cleaned;
}
