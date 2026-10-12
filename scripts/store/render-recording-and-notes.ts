import type { NotesExcerpt } from './excerpt-notes';
import { formatFileSize } from './format-file-size';

/** What the fourth store screenshot shows: one meeting's two saved files. */
export interface RecordingAndNotes {
  /** The folder the files are in, as the person sees it. */
  folder: string;
  /** The saved recording, and a frame of it as an image URL. */
  recording: { name: string; bytes: number; frame: string };
  notes: { name: string; bytes: number; excerpt: NotesExcerpt };
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { background: #1e2a47; color: #1f2433; font: 15px system-ui, sans-serif; padding: 24px;
    display: flex; align-items: center; }
  /* As tall as the taller column, at most the window: long notes get the whole height. */
  .meeting { display: flex; gap: 20px; width: 100%; max-height: 752px; }
  .saved { width: 520px; flex: none; display: flex; flex-direction: column; justify-content: center;
    gap: 20px; }
  .panel { background: #fff; border-radius: 8px; overflow: hidden; }
  .title, .folder { margin: 0; padding: 9px 16px; background: #eef0f5; border-bottom: 1px solid #dde1ea;
    font-weight: 600; font-size: 14px; color: #3a4256; }
  .files { list-style: none; margin: 0; padding: 8px 16px; }
  .file { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .kind { width: 40px; padding: 4px 0; border-radius: 4px; color: #fff; font-size: 10px;
    font-weight: 700; text-align: center; }
  .kind.webm { background: #e5484d; }
  .kind.md { background: #5a6b8c; }
  .name { flex: 1; font-size: 14px; overflow-wrap: anywhere; }
  .size { color: #6b7385; font-size: 14px; }
  .recording { background: #202124; }
  .recording img { display: block; width: 100%; height: auto; }
  .notes { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .lines { margin: 0; padding: 10px 16px; flex: 1; min-height: 0; overflow: hidden;
    font: 13px/18px ui-monospace, 'DejaVu Sans Mono', monospace; }
  .lines.cut { mask-image: linear-gradient(to bottom, black calc(100% - 40px), transparent); }
  .line { display: flex; gap: 12px; }
  .number { width: 2.5em; flex: none; text-align: right; color: #9aa3b5; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .more { padding-left: calc(2.5em + 12px); color: #9aa3b5; }
`;

/** Notes longer than their panel fade out at its bottom; notes that fit keep their last line clear. */
const FADE_WHEN_CUT = `
  const lines = document.querySelector('.lines');
  if (lines.scrollHeight > lines.clientHeight) lines.classList.add('cut');
`;

/** After the last line shown, when the file goes on: the picture does not pass for the whole file. */
const MORE = '<div class="more">…</div>';

const fileRow = (kind: 'webm' | 'md', name: string, bytes: number): string =>
  `<li class="file"><span class="kind ${kind}">${kind.toUpperCase()}</span>` +
  `<span class="name">${escapeHtml(name)}</span><span class="size">${formatFileSize(bytes)}</span></li>`;

const noteLine = (text: string, index: number, firstLine: number): string =>
  `<div class="line"><span class="number">${firstLine + index}</span>` +
  `<span class="text">${escapeHtml(text)}</span></div>`;

/**
 * The page of the fourth store screenshot, 1280 by 800: on the left the folder with the meeting's
 * recording and notes, and a frame of the recording; on the right the notes as written, each line
 * under its number in the file, so the picture shows no line left out. The notes panel is as tall
 * as the left column, and grows to the window's height for notes that say more, so a picture of
 * notes naming participants and events shows them. Notes longer than that fade out at its bottom,
 * and a mark follows the last line shown when the file goes on.
 */
export function renderRecordingAndNotes({ folder, recording, notes }: RecordingAndNotes): string {
  const { firstLine, lines, more } = notes.excerpt;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Saved meeting</title><style>${STYLE}</style></head>
<body>
  <div class="meeting">
    <div class="saved">
      <section class="panel"><h2 class="folder">${escapeHtml(folder)}</h2>
        <ul class="files">${fileRow('webm', recording.name, recording.bytes)}${fileRow('md', notes.name, notes.bytes)}</ul>
      </section>
      <section class="panel recording"><h2 class="title">${escapeHtml(recording.name)}</h2>
        <img src="${escapeHtml(recording.frame)}" alt="A frame of the recording"></section>
    </div>
    <section class="panel notes"><h2 class="title">${escapeHtml(notes.name)}</h2>
      <div class="lines">${lines.map((text, index) => noteLine(text, index, firstLine)).join('')}${more ? MORE : ''}</div></section>
  </div>
  <script>${FADE_WHEN_CUT}</script>
</body></html>
`;
}
