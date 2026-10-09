import { describe, expect, it } from 'vitest';
import { cleanText } from './clean-text';

describe('cleanText', () => {
  it.each<[string, string, string]>([
    ['a plain name', 'Ana Souza', 'Ana Souza'],
    ['a word YAML reads as false', 'no', 'no'],
    ['a word YAML reads as null', 'null', 'null'],
    ['a date', '2026-10-04', '2026-10-04'],
    ['a number with a leading zero', '0123', '0123'],
    ['a colon and space', 'Ben: Carter', 'Ben: Carter'],
    ['a hash', '#tag', '#tag'],
    ['a leading dash', '- dash', '- dash'],
    ['quotes', 'Jo "JR" O\'Neil', 'Jo "JR" O\'Neil'],
    ['a backslash', 'C:\\temp', 'C:\\temp'],
    ['a tab', 'Ana\tSouza', 'Ana Souza'],
    ['a newline', 'Ana\nSouza', 'Ana Souza'],
    ['a carriage return and newline', 'Ana\r\nSouza', 'Ana Souza'],
    ['a next line (NEL)', 'Ana\u0085Souza', 'Ana Souza'],
    ['a line separator', 'Ana\u2028Souza', 'Ana Souza'],
    ['a paragraph separator', 'Ana\u2029Souza', 'Ana Souza'],
    ['spaces around and inside', '  Ana   Souza  ', 'Ana Souza'],
    ['a C0 control', 'Ana\u0007Souza', 'AnaSouza'],
    ['DEL', 'Ana\u007fSouza', 'AnaSouza'],
    ['a C1 control', 'Ana\u0090Souza', 'AnaSouza'],
    ['a byte order mark', '\ufeffAna Souza', 'Ana Souza'],
    ['the noncharacters U+FFFE and U+FFFF', 'Ana\ufffe\uffffSouza', 'AnaSouza'],
    ['a lone surrogate', 'Ana\ud800Souza', 'Ana\ufffdSouza'],
    ['a right-to-left override', '\u202eanazuoS', 'anazuoS'],
    ['left-to-right and right-to-left marks', '\u200eAna\u200f', 'Ana'],
    ['an Arabic letter mark', 'Ana\u061c', 'Ana'],
    ['bidi isolates', '\u2066Ana\u2069 \u2068Souza\u2069', 'Ana Souza'],
    ['bidi embeddings', '\u202aAna\u202c', 'Ana'],
    ['an emoji joined with ZWJ', 'Ana 👩\u200d💻', 'Ana 👩\u200d💻'],
    ['a zero-width non-joiner', 'می\u200cخواهم', 'می\u200cخواهم'],
    ['Arabic', 'آنا سوزا', 'آنا سوزا'],
    ['300 characters', 'a'.repeat(300), 'a'.repeat(300)],
    ['nothing left', ' \u200e\u0007 ', ''],
  ])('%s', (_label, input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });
});
