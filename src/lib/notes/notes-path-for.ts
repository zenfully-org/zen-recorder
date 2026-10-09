import { buildDownloadPath } from '@/lib/finalize/build-download-path';
import { leafOfPath } from '@/lib/notes/leaf-of-path';

/**
 * Where a recording's notes are saved, relative to the downloads folder: the saved recording's
 * file name (its leaf, split on `/` and `\`) with `.md` for its last extension, in the folder the
 * recording was saved in. From the saved name, because Firefox names a second file of the same name
 * `X(1).webm`, which a name built again from the template would miss. Null when the leaf has no
 * name before its extension.
 */
export function notesPathFor(savedFilename: string, subfolder: string): string | null {
  const leaf = leafOfPath(savedFilename);
  const dot = leaf.lastIndexOf('.');
  const base = dot === -1 ? leaf : leaf.slice(0, dot);
  if (base === '') return null;
  // The folder the recording went to, as the recording's own path names it from the setting.
  const sample = buildDownloadPath({
    template: 'notes',
    subfolder,
    title: '',
    meetingCode: '',
    provider: '',
    startedAt: 0,
    extension: 'md',
  });
  return `${sample.slice(0, sample.lastIndexOf('/') + 1)}${base}.md`;
}
