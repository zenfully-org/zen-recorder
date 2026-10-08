// @vitest-environment node
/**
 * The project's texts are written once: the manifest and the Options page read them from
 * `getProjectTexts`, and the README, the store listing (`docs/store/listing.md`), the release
 * notes, the install page and the metadata sent to addons.mozilla.org must say the same words, so
 * these tests read those files too. The privacy policy is written in `docs/store/privacy.md` and
 * published as the site's `privacy.html`, which must say the same.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getProjectTexts } from './get-project-texts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const NOTICE =
  'Zen Recorder is an independent project. It is not affiliated with, endorsed by or sponsored by ' +
  'Zen Browser or its team. The maintainer uses Zen Browser, which is why the recorder targets ' +
  'Firefox-based browsers.';
const SHORT_NOTICE = 'Independent project, not affiliated with Zen Browser.';
/** AMO's limit for the summary, which it fills from the manifest description. */
const AMO_SUMMARY_MAX = 250;
/**
 * AMO's limit for a version's notes to reviewer (`Version.approval_notes`, enforced by its API):
 * longer notes fail the signing step of a release, after the maintainer approved it.
 */
const AMO_APPROVAL_NOTES_MAX = 3000;
/** Where the release workflow publishes `site/privacy.html` (GitHub Pages of the gh-pages branch). */
const PRIVACY_POLICY = 'https://zenfully-org.github.io/zen-recorder/privacy.html';

const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * The metadata the release workflow sends to addons.mozilla.org with each signed version, one file
 * per channel it signs on.
 */
const AMO_METADATA = ['.github/amo-metadata/unlisted.json', '.github/amo-metadata/listed.json'];

const AmoMetadata = z.object({
  summary: z.object({ 'en-US': z.string() }),
  categories: z.array(z.string()),
  version: z.object({ license: z.string(), approval_notes: z.string() }),
});

const amoMetadata = (file: string) => AmoMetadata.parse(JSON.parse(read(file)));

/** Markdown prose as one line: quote markers and line wrapping removed. */
const prose = (markdown: string): string => markdown.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');

/** Prose as its sentences, so that a difference names the sentence it is in. */
const sentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.:!?]) /);

/** The text of Markdown without its markup: link targets, emphasis, code marks and line markers. */
const markdownText = (markdown: string): string =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^(#+|-|>) /gm, '')
    .replace(/[*`]/g, '');

/** The text of an HTML fragment without its tags, with the entities the pages use decoded. */
const htmlText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The content of the first fenced block under the `## <heading>` of a Markdown file. */
function fencedBlockAfter(markdown: string, heading: string): string {
  const section = markdown.split(`\n## ${heading}\n`)[1] ?? '';
  return /```\w*\n([\s\S]*?)\n```/.exec(section)?.[1] ?? '';
}

describe('getProjectTexts', () => {
  it('names the extension', () => {
    expect(getProjectTexts().name).toBe('Zen Recorder');
  });

  it('carries the independence notice in the words decided for every presentation', () => {
    expect(getProjectTexts().notice).toBe(NOTICE);
  });

  it('ends the manifest description with the short notice, short enough for the AMO summary', () => {
    const { description } = getProjectTexts();

    expect(description.endsWith(` ${SHORT_NOTICE}`)).toBe(true);
    expect(description.length).toBeLessThanOrEqual(AMO_SUMMARY_MAX);
  });

  it.each([
    'README.md',
    'docs/store/listing.md',
    '.github/release-notes-footer.md',
    'site/index.html',
  ])('is quoted word for word in %s', (file) => {
    expect(prose(read(file))).toContain(NOTICE);
  });

  it.each(AMO_METADATA)('lists on addons.mozilla.org the categories %s sends', (file) => {
    const row = /^\| Firefox categories \|(.*)\|$/m.exec(read('docs/store/listing.md'))?.[1] ?? '';

    expect([...row.matchAll(/`([a-z-]+)`/g)].map((match) => match[1])).toEqual(
      amoMetadata(file).categories,
    );
  });

  it.each(AMO_METADATA)(
    'points the reviewers of the versions %s goes with at README-REVIEWERS.md',
    (file) => {
      expect(amoMetadata(file).version.approval_notes).toContain('README-REVIEWERS.md');
    },
  );

  it.each(AMO_METADATA)(
    'keeps the notes to reviewer of %s within what addons.mozilla.org takes',
    (file) => {
      expect(amoMetadata(file).version.approval_notes.length).toBeLessThanOrEqual(
        AMO_APPROVAL_NOTES_MAX,
      );
    },
  );

  it("sends the listing's notes to reviewer with each listed version", () => {
    expect(amoMetadata('.github/amo-metadata/listed.json').version.approval_notes).toBe(
      fencedBlockAfter(read('docs/store/listing.md'), 'Notes to reviewer'),
    );
  });

  it.each(AMO_METADATA)(
    'gives addons.mozilla.org the manifest description as the summary in %s',
    (file) => {
      expect(amoMetadata(file).summary['en-US']).toBe(getProjectTexts().description);
    },
  );

  it.each(AMO_METADATA)("gives addons.mozilla.org the project's licence in %s", (file) => {
    const { license } = z.object({ license: z.string() }).parse(JSON.parse(read('package.json')));

    expect(amoMetadata(file).version.license).toBe(license);
  });

  it('puts the notice on the first screen of the README, before any other section', () => {
    const readme = read('README.md');

    expect(prose(readme.split('\n## ')[0] ?? '')).toContain(NOTICE);
  });

  describe('docs/store/listing.md', () => {
    const listing = (): string => read('docs/store/listing.md');

    it('holds the manifest description as the manifest has it', () => {
      expect(fencedBlockAfter(listing(), 'Manifest description')).toBe(
        getProjectTexts().description,
      );
    });

    it('has the manifest description as the AMO summary, since AMO fills the summary from it', () => {
      expect(fencedBlockAfter(listing(), 'AMO summary')).toBe(getProjectTexts().description);
    });

    it('has an AMO description that carries the notice', () => {
      expect(prose(fencedBlockAfter(listing(), 'AMO description'))).toContain(NOTICE);
    });

    it('has a one-line repository description that says it is an independent project', () => {
      const description = fencedBlockAfter(listing(), 'Repository description');

      expect(description).not.toContain('\n');
      expect(description.toLowerCase()).toContain('independent project');
    });
  });
});

describe('the privacy policy', () => {
  it('says on the site what docs/store/privacy.md says, sentence by sentence', () => {
    const page = /<article>([\s\S]*)<\/article>/.exec(read('site/privacy.html'))?.[1] ?? '';

    expect(sentences(htmlText(page))).toEqual(
      sentences(markdownText(read('docs/store/privacy.md'))),
    );
  });

  it.each(['README.md', 'docs/store/listing.md', '.github/release-notes-footer.md'])(
    'is linked from %s',
    (file) => {
      expect(read(file)).toContain(PRIVACY_POLICY);
    },
  );
});
