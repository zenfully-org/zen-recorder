/**
 * The downloads subfolder as a name Firefox's downloads API accepts. On top of what any name needs
 * (`sanitizeFilenameComponent`): Firefox's sanitizer appends `.download` to a name whose last
 * extension is `.lnk`, `.local`, `.url`, `.scf` or `.desktop`, in any case and for folders too
 * (`nsExternalHelperAppService::SanitizeFileName`), and the API then refuses the whole path, so
 * every save failed. The last dot of such a name becomes `_` (`meetings.local` → `meetings_local`).
 * A folder keeps the whitespace inside its extension (`. local` is no `.local`), as Firefox does.
 * A file name never needs this: it ends in the recording's own extension.
 */
import { sanitizeFilenameComponent } from '@/lib/finalize/sanitize-filename-component';

const DOWNLOAD_SUFFIXED_RE = /\.(lnk|local|url|scf|desktop)$/i;

export function sanitizeFolderName(input: string): string {
  return sanitizeFilenameComponent(input, '').replace(DOWNLOAD_SUFFIXED_RE, '_$1');
}
