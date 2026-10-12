import { renderRecordingAndNotes } from './render-recording-and-notes';

const FRAME = 'data:image/png;base64,iVBORw0KGgo=';

function render(title = 'Weekly product sync', more = true): Document {
  const html = renderRecordingAndNotes({
    folder: 'Downloads / zen-recorder',
    recording: { name: `2026-10-12_09-28_${title}.webm`, bytes: 1_312_345, frame: FRAME },
    notes: {
      name: `2026-10-12_09-28_${title}.md`,
      bytes: 3_104,
      excerpt: {
        firstLine: 22,
        lines: [`# ${title}`, '', '- **Recorded:** 09:28:45 to 09:29:41'],
        more,
      },
    },
  });
  return new DOMParser().parseFromString(html, 'text/html');
}

const texts = (page: Document, selector: string): string[] =>
  [...page.querySelectorAll(selector)].map((element) => element.textContent ?? '');

describe('renderRecordingAndNotes', () => {
  it('lists the two files in their folder, with their sizes', () => {
    const page = render();

    expect(texts(page, '.folder')).toEqual(['Downloads / zen-recorder']);
    expect(texts(page, '.file .name')).toEqual([
      '2026-10-12_09-28_Weekly product sync.webm',
      '2026-10-12_09-28_Weekly product sync.md',
    ]);
    expect(texts(page, '.file .size')).toEqual(['1.3 MB', '3.1 kB']);
    expect(texts(page, '.file .kind')).toEqual(['WEBM', 'MD']);
  });

  it('shows the frame of the recording under its name', () => {
    const page = render();

    expect(texts(page, '.recording .title')).toEqual(['2026-10-12_09-28_Weekly product sync.webm']);
    expect(page.querySelector('.recording img')?.getAttribute('src')).toBe(FRAME);
  });

  it('shows the notes as written, each line under its number in the file', () => {
    const page = render();

    expect(texts(page, '.notes .title')).toEqual(['2026-10-12_09-28_Weekly product sync.md']);
    expect(texts(page, '.notes .line .number')).toEqual(['22', '23', '24']);
    expect(texts(page, '.notes .line .text')).toEqual([
      '# Weekly product sync',
      '',
      '- **Recorded:** 09:28:45 to 09:29:41',
    ]);
  });

  it('ends the notes with a mark when the file goes on after them', () => {
    expect(texts(render('Weekly product sync', true), '.notes .more')).toEqual(['…']);
    expect(texts(render('Weekly product sync', false), '.notes .more')).toEqual([]);
  });

  it('fades the notes out at the bottom only when they run past the panel', () => {
    const page = render();
    const style = page.querySelector('style')?.textContent ?? '';
    const script = page.querySelector('script')?.textContent ?? '';

    expect(style).toMatch(/\.lines\.cut \{ mask-image: linear-gradient/);
    expect(style.match(/mask-image/g)).toHaveLength(1);
    expect(script).toContain('lines.scrollHeight > lines.clientHeight');
    expect(script).toContain("lines.classList.add('cut')");
  });

  it('shows a title with markup characters as text', () => {
    const page = render('<b>Q4</b> & "plans"');

    expect(texts(page, '.file .name')[0]).toBe('2026-10-12_09-28_<b>Q4</b> & "plans".webm');
    expect(texts(page, '.notes .line .text')[0]).toBe('# <b>Q4</b> & "plans"');
    expect(page.querySelector('b')).toBeNull();
  });
});
