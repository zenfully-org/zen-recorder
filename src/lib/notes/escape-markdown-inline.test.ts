import { describe, expect, it } from 'vitest';
import { escapeMarkdownInline } from './escape-markdown-inline';

describe('escapeMarkdownInline', () => {
  it.each<[string, string]>([
    ['Ana Souza', 'Ana Souza'],
    ['*x*', '\\*x\\*'],
    ['__init__', '\\_\\_init\\_\\_'],
    ['<b>', '\\<b\\>'],
    ['[a](b)', '\\[a\\](b)'],
    ['Chloé Martin | Design', 'Chloé Martin \\| Design'],
    ['# h', '\\# h'],
    ['1. x', '1\\. x'],
    ['2) x', '2\\) x'],
    ['12. x', '12\\. x'],
    ['v1.2', 'v1.2'],
    ['---', '\\---'],
    ['+1', '\\+1'],
    ['a-b+c', 'a-b+c'],
    ['==hl==', '\\=\\=hl\\=\\='],
    ['%%c%%', '\\%\\%c\\%\\%'],
    ['$x^2$', '\\$x\\^2\\$'],
    ['`code`', '\\`code\\`'],
    ['a\\b', 'a\\\\b'],
    ['~~s~~', '\\~\\~s\\~\\~'],
    ['R&D!', 'R\\&D\\!'],
    // A table cell or a list item stays on one line.
    ['Ana\nSouza', 'Ana Souza'],
  ])('writes %j as %s', (input, expected) => {
    expect(escapeMarkdownInline(input)).toBe(expected);
  });
});
