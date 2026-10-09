// @vitest-environment node
import { renderChangeGroups } from './render-change-groups';

describe('renderChangeGroups', () => {
  it('writes each group as the changelog does: a heading, then one bullet per entry', () => {
    const text = renderChangeGroups([
      { group: 'Added', file: 'changes/added/3.md', text: 'Feature three,\nover two lines. (#3)' },
      { group: 'Added', file: 'changes/added/4.md', text: 'Feature four. (#4)' },
      {
        group: 'Changed',
        file: 'changes/changed/id.md',
        text: 'Move once:\n1. First.\n\nThen go on.',
      },
    ]);

    expect(text).toBe(
      [
        '### Added',
        '',
        '- Feature three,',
        '  over two lines. (#3)',
        '- Feature four. (#4)',
        '',
        '### Changed',
        '',
        '- Move once:',
        '  1. First.',
        '',
        '  Then go on.',
      ].join('\n'),
    );
  });

  it('writes nothing for no entries', () => {
    expect(renderChangeGroups([])).toBe('');
  });
});
