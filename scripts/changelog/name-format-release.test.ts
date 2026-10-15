// @vitest-environment node
import { nameFormatRelease } from './name-format-release';

const doc = (...changelog: string[]) =>
  ['# Meeting notes format', '', '## Changelog', '', ...changelog, ''].join('\n');

const NEW = '- **1.2** (unreleased): additions only. `capture.x` is new.';
const NAMED = '- **1.1** (Zen Recorder 0.5.0): additions only.';
const FIRST = '- **1.0** (Zen Recorder 0.4.0): the first version.';

describe('nameFormatRelease', () => {
  it.each([
    [
      'names the release that first writes the version',
      doc(NEW, NAMED, FIRST),
      '1.2',
      doc('- **1.2** (Zen Recorder 0.6.0): additions only. `capture.x` is new.', NAMED, FIRST),
    ],
    // A release that writes no new format version: the version's line names its first writer.
    [
      'leaves a version an earlier release wrote first',
      doc(NAMED, FIRST),
      '1.1',
      doc(NAMED, FIRST),
    ],
    [
      'touches no other version, unreleased or not',
      doc('- **1.3** (unreleased): planned.', NAMED, FIRST),
      '1.1',
      doc('- **1.3** (unreleased): planned.', NAMED, FIRST),
    ],
    [
      'changes only the parenthesis after the version',
      doc('- **1.2** (unreleased): what 1.1 (unreleased) left out.', NAMED),
      '1.2',
      doc('- **1.2** (Zen Recorder 0.6.0): what 1.1 (unreleased) left out.', NAMED),
    ],
  ])('%s', (_label, text, version, expected) => {
    expect(nameFormatRelease(text, version, '0.6.0')).toBe(expected);
  });

  // A doc that never mentions the version the build writes would ship without saying what it is.
  it('refuses a doc whose changelog has no line for the version', () => {
    expect(() => nameFormatRelease(doc(NAMED, FIRST), '1.2', '0.6.0')).toThrow(
      'docs/meeting-notes-format.md has no changelog line for format 1.2 ("- **1.2** (…")',
    );
  });
});
