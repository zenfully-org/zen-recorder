// @vitest-environment node
import { parseBiomeExplain } from './parse-biome-explain';

/** `biome explain noFocusedTests` (Biome 2.6.3), the globals and the description cut short. */
const FOCUSED_TESTS = `Summary

- Name: noFocusedTests
- Fix: unsafe
- Default severity: warn
- Available from version: 1.6.0
- Diagnostic category: lint/suspicious/noFocusedTests

Domains

- Name: test
- The rule is recommended for this domain
- The rule is enabled when one of these dependencies are detected:
  - jest@>=26.0.0
  - mocha@>=8.0.0
  - ava@>=2.0.0
  - vitest@>=1.0.0
- The rule adds the following globals:
  - after
  - describe
  - it


Description

 Disallow focused tests.

 - The rule is recommended for this domain
`;

/** `biome explain noSyncScripts`: a rule of two domains, recommended for neither. */
const SYNC_SCRIPTS = `Summary

- Name: noSyncScripts
- No fix available.
- Default severity: warn
- Available from version: 2.3.6
- Diagnostic category: lint/performance/noSyncScripts

Domains

- Name: react
- The rule is enabled when one of these dependencies are detected:
  - react@>=16.0.0

- Name: next
- The rule is enabled when one of these dependencies are detected:
  - next@>=14.0.0


Description

 Prevent the usage of synchronous scripts.
`;

/** `biome explain noPrivateImports`: a domain no dependency turns on. */
const PRIVATE_IMPORTS = `Summary

- Name: noPrivateImports
- No fix available.
- Default severity: warn
- Available from version: 2.0.0
- Diagnostic category: lint/correctness/noPrivateImports

Domains

- Name: project
- The rule is recommended for this domain


Description

 Restrict imports of private exports.
`;

/** `biome explain noDebugger`: a rule of no domain. */
const DEBUGGER = `Summary

- Name: noDebugger
- Fix: unsafe
- Default severity: error
- Available from version: 1.0.0
- Diagnostic category: lint/suspicious/noDebugger
- This rule is recommended

Description

 Disallow the use of \`debugger\`

 - Name: not a domain
`;

describe('parseBiomeExplain', () => {
  it.each([
    {
      rule: 'noFocusedTests',
      text: FOCUSED_TESTS,
      expected: {
        name: 'suspicious/noFocusedTests',
        level: 'warn',
        domains: [
          {
            name: 'test',
            recommended: true,
            dependencies: ['jest@>=26.0.0', 'mocha@>=8.0.0', 'ava@>=2.0.0', 'vitest@>=1.0.0'],
          },
        ],
      },
    },
    {
      rule: 'noSyncScripts',
      text: SYNC_SCRIPTS,
      expected: {
        name: 'performance/noSyncScripts',
        level: 'warn',
        domains: [
          { name: 'react', recommended: false, dependencies: ['react@>=16.0.0'] },
          { name: 'next', recommended: false, dependencies: ['next@>=14.0.0'] },
        ],
      },
    },
    {
      rule: 'noPrivateImports',
      text: PRIVATE_IMPORTS,
      expected: {
        name: 'correctness/noPrivateImports',
        level: 'warn',
        domains: [{ name: 'project', recommended: true, dependencies: [] }],
      },
    },
    {
      rule: 'noDebugger',
      text: DEBUGGER,
      expected: { name: 'suspicious/noDebugger', level: 'error', domains: [] },
    },
  ])('reads $rule: its group, its default level and its domains', ({ text, expected }) => {
    expect(parseBiomeExplain(text)).toEqual(expected);
  });

  it('refuses a text without the summary it reads, rather than guess a level', () => {
    expect(() => parseBiomeExplain('Unrecognized option react.')).toThrow(/Unrecognized option/);
  });
});
