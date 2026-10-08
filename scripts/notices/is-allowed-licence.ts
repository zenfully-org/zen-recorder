/**
 * What the extension may bundle, as lower-case SPDX identifiers. The project is MIT, so permissive
 * licences only, plus MPL-2.0: its copyleft is per file, so Mediabunny's files keep it and the
 * extension around them stays MIT (MPL-2.0 section 3.3). Never GPL, LGPL, AGPL or SSPL.
 */
const ALLOWED = new Set([
  'mit',
  'isc',
  'bsd-2-clause',
  'bsd-3-clause',
  'apache-2.0',
  '0bsd',
  'mpl-2.0',
]);

/** Words that cannot stand where a licence is expected. */
const RESERVED = new Set(['AND', 'OR', 'WITH', '(', ')']);

/**
 * Whether a package's `license` field lets the project bundle it. The field is an SPDX expression
 * (https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/): `A OR B` needs one of them on
 * the list, `A AND B` both, parentheses group. Identifiers and operators are read in any case.
 * Whatever the check cannot read is refused rather than guessed at: an exception (`WITH`), which
 * changes the licence's terms, an "or later" `+`, `UNLICENSED`, `SEE LICENSE IN …`, a malformed
 * expression.
 */
export function isAllowedLicence(expression: string): boolean {
  const tokens = expression.match(/[()]|[^\s()]+/g) ?? [];
  let position = 0;

  const peek = (): string | undefined => tokens[position]?.toUpperCase();
  const take = (): string => {
    const token = tokens[position];
    if (token === undefined) throw new SyntaxError('the expression ends early');
    position += 1;
    return token;
  };

  const readOne = (): boolean => {
    const token = take();
    if (token === '(') {
      const allowed = readEither();
      if (take() !== ')') throw new SyntaxError('a parenthesis is not closed');
      return allowed;
    }
    if (RESERVED.has(token.toUpperCase())) throw new SyntaxError(`unexpected ${token}`);
    return ALLOWED.has(token.toLowerCase());
  };
  const readBoth = (): boolean => {
    let allowed = readOne();
    while (peek() === 'AND') {
      take();
      const right = readOne();
      allowed = allowed && right;
    }
    return allowed;
  };
  const readEither = (): boolean => {
    let allowed = readBoth();
    while (peek() === 'OR') {
      take();
      const right = readBoth();
      allowed = allowed || right;
    }
    return allowed;
  };

  try {
    const allowed = readEither();
    // Anything left over (`WITH`, a second identifier, a stray parenthesis) is unreadable.
    return allowed && position === tokens.length;
  } catch {
    return false;
  }
}
