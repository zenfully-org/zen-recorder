import { sanitizeFilenameComponent } from '@/lib/finalize/sanitize-filename-component';
import { sanitizeFolderName } from '@/lib/finalize/sanitize-folder-name';

export interface DownloadPathInput {
  template: string;
  subfolder: string;
  title: string;
  meetingCode: string;
  /** Provider id (`meet`, `zoom`, `teams`). */
  provider: string;
  startedAt: number;
  extension: string;
  suffix?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Renders the filename template into a download path relative to the Downloads folder. */
export function buildDownloadPath(input: DownloadPathInput): string {
  const d = new Date(input.startedAt);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const rendered = input.template
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .replaceAll('{title}', input.title)
    .replaceAll('{code}', input.meetingCode)
    .replaceAll('{provider}', input.provider);
  const base = sanitizeFilenameComponent(rendered, `${date}_${time}_recording`);
  const suffixPart = input.suffix ? sanitizeFilenameComponent(input.suffix, '') : '';
  const suffix = suffixPart ? ` ${suffixPart}` : '';
  const folder = sanitizeFolderName(input.subfolder);
  const file = `${base}${suffix}.${input.extension}`;
  return folder ? `${folder}/${file}` : file;
}
