import { describe, expect, it } from 'vitest';
import { sanitizeFilenameComponent } from './sanitize-filename-component';

describe('sanitizeFilenameComponent', () => {
  it.each([
    ['Weekly sync: Q3/Q4 plan?', 'Weekly sync Q3 Q4 plan'],
    ['...hidden...', 'hidden'],
    ['. .hidden. .', 'hidden'],
    ['   ', 'recording'],
    ['tab\there <> "quoted" | pipe * star', 'tab here quoted pipe star'],
    ['back\\slash', 'back slash'],
    ['ok-name_1', 'ok-name_1'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFilenameComponent(input)).toBe(expected);
  });

  // Firefox's downloads API refuses a name its own sanitizer would change: these titles failed
  // the save.
  it.each([
    {
      name: 'a zero-width joiner in an emoji',
      input: 'Dev 👨\u200D💻 sync',
      expected: 'Dev 👨💻 sync',
    },
    {
      name: 'right-to-left marks',
      input: 'Weekly \u200Fשלום\u200F sync',
      expected: 'Weekly שלום sync',
    },
    { name: 'left-to-right marks', input: 'Call with \u200Eדנה\u200E', expected: 'Call with דנה' },
    { name: 'bidi isolates', input: 'Team \u2066Ana\u2069 sync', expected: 'Team Ana sync' },
    { name: 'a soft hyphen', input: 'Kick\u00ADoff', expected: 'Kickoff' },
    { name: 'a zero-width space', input: 'Q3\u200Bplan', expected: 'Q3plan' },
    { name: 'a byte order mark', input: '\uFEFFStandup', expected: 'Standup' },
    {
      name: 'the tag characters of a flag emoji',
      input: '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} Cup',
      expected: '🏴 Cup',
    },
    { name: 'DEL', input: 'Del\u007Fete', expected: 'Del ete' },
    { name: 'a C1 control (next line)', input: 'Next\u0085line', expected: 'Next line' },
    { name: 'a line separator', input: 'Two\u2028lines', expected: 'Two lines' },
    { name: 'no-break spaces', input: '10:00\u202FAM\u00A0sync', expected: '10 00 AM sync' },
    { name: 'a lone surrogate', input: 'Lone \uD83D half', expected: 'Lone half' },
  ])('removes $name', ({ input, expected }) => {
    expect(sanitizeFilenameComponent(input)).toBe(expected);
  });

  it.each([
    { name: 'an emoji', input: 'Party 🎉 time' },
    { name: 'an emoji with a variation selector', input: 'Heart ❤\uFE0F check' },
    { name: 'a decomposed accent', input: 'Cafe\u0301 review' },
    { name: 'right-to-left text', input: 'שלום' },
    { name: 'a percent sign (Firefox itself saves it as _)', input: '100% done' },
  ])('keeps $name', ({ input }) => {
    expect(sanitizeFilenameComponent(input)).toBe(input);
  });

  // Windows refuses these device names, alone or before a dot (Gecko's `CheckForReservedFileName`).
  it.each([
    { input: 'CON', expected: 'recording' },
    { input: 'lpt1', expected: 'recording' },
    { input: 'clock$', expected: 'recording' },
    { input: 'con.notes', expected: 'recording' },
    { input: 'Aux.', expected: 'recording' },
    { input: 'console', expected: 'console' },
    { input: 'COM1 review', expected: 'COM1 review' },
  ])('$input → $expected (Windows device names)', ({ input, expected }) => {
    expect(sanitizeFilenameComponent(input)).toBe(expected);
  });

  // At most 80 characters and 200 UTF-8 bytes, cut between two characters: room for
  // ` (recovered) raw`, Firefox's `(N)`, the extension and its `.part` file in 255 bytes.
  it.each([
    { name: 'ASCII: 80 characters', input: 'a'.repeat(100), expected: 'a'.repeat(80) },
    {
      name: 'an emoji across the cut stays whole',
      input: `${'a'.repeat(79)}🎉🎉`,
      expected: `${'a'.repeat(79)}🎉`,
    },
    { name: 'two-byte letters: 80, 160 bytes', input: 'é'.repeat(100), expected: 'é'.repeat(80) },
    { name: 'CJK: 66, 198 bytes', input: '会'.repeat(80), expected: '会'.repeat(66) },
    {
      name: 'CJK after ASCII: 200 bytes',
      input: `ab${'会'.repeat(80)}`,
      expected: `ab${'会'.repeat(66)}`,
    },
    { name: 'emoji: 50, 200 bytes', input: '🎉'.repeat(80), expected: '🎉'.repeat(50) },
    { name: 'no space left at the cut', input: `${'a'.repeat(79)} b`, expected: 'a'.repeat(79) },
    { name: 'no dot left at the cut', input: `${'a'.repeat(79)}.b`, expected: 'a'.repeat(79) },
  ])('bounds the length: $name', ({ input, expected }) => {
    expect(sanitizeFilenameComponent(input)).toBe(expected);
  });

  it('uses the given fallback', () => {
    expect(sanitizeFilenameComponent('', 'x')).toBe('x');
  });
});
