// @vitest-environment node
/**
 * The project is MIT, so what the extension bundles must be under a permissive licence or under
 * MPL-2.0, whose copyleft stays inside the library's own files. A package's `license` field is an
 * SPDX expression: the check accepts it when the licences it allows the project to use are all on
 * that list, and refuses everything it cannot read rather than guess.
 */
import { isAllowedLicence } from './is-allowed-licence';

describe('isAllowedLicence', () => {
  it.each(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'MPL-2.0'])(
    'allows %s',
    (expression) => {
      expect(isAllowedLicence(expression)).toBe(true);
    },
  );

  it.each([
    'GPL-3.0-only',
    'GPL-2.0-or-later',
    'LGPL-3.0-or-later',
    'AGPL-3.0-only',
    'SSPL-1.0',
    'CC-BY-NC-4.0',
    'UNLICENSED',
    'SEE LICENSE IN LICENSE.md',
  ])('refuses %s', (expression) => {
    expect(isAllowedLicence(expression)).toBe(false);
  });

  it.each([
    { expression: 'mit', allowed: true, why: 'an identifier in another case' },
    { expression: '  MIT  ', allowed: true, why: 'spaces around it' },
    { expression: '(MIT OR GPL-3.0-only)', allowed: true, why: 'a choice that offers MIT' },
    { expression: 'GPL-3.0-only OR Apache-2.0', allowed: true, why: 'Apache-2.0 offered second' },
    { expression: 'MIT or GPL-3.0-only', allowed: true, why: 'an operator in lower case' },
    { expression: 'MIT AND ISC', allowed: true, why: 'two licences that both apply' },
    { expression: 'MIT AND GPL-3.0-only', allowed: false, why: 'GPL applying alongside MIT' },
    {
      expression: '(MIT AND GPL-3.0-only) OR (ISC AND (0BSD OR AGPL-3.0-only))',
      allowed: true,
      why: 'nested parentheses with one allowed path',
    },
    { expression: '(GPL-3.0-only OR AGPL-3.0-only)', allowed: false, why: 'only copyleft offered' },
    { expression: 'MIT OR', allowed: false, why: 'a missing operand' },
    { expression: '(MIT', allowed: false, why: 'an unclosed parenthesis' },
    { expression: '(MIT ISC)', allowed: false, why: 'a parenthesis closed by something else' },
    { expression: 'MIT)', allowed: false, why: 'an unopened parenthesis' },
    { expression: '()', allowed: false, why: 'empty parentheses' },
    { expression: '', allowed: false, why: 'an empty expression' },
    {
      expression: 'Apache-2.0 WITH LLVM-exception',
      allowed: false,
      why: 'an exception, which changes the licence',
    },
    { expression: 'Apache-2.0+', allowed: false, why: '"or any later version", unknown terms' },
    { expression: 'MIT ISC', allowed: false, why: 'two identifiers without an operator' },
    { expression: 'MIT OR AND', allowed: false, why: 'an operator where a licence belongs' },
  ])('$why: "$expression" is allowed: $allowed', ({ expression, allowed }) => {
    expect(isAllowedLicence(expression)).toBe(allowed);
  });
});
