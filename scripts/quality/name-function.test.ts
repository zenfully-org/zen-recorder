// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nameFunction } from './name-function';

const factory = `
export function createThing(deps: { items: number[] }) {
  const handle = (msg: string) => {
    deps.items.forEach((item) => {
      if (item > 1) console.log(msg);
    });
    deps.items.map((item) => item * 2);
    return deps.items.map(function (item) {
      return item + 1;
    });
  };
  const api = {
    stop() {
      return handle('stop');
    },
    pause: () => handle('pause'),
    'quoted-name': () => handle('quoted'),
  };
  return api;
}
export const helper = async () => 1;
const top = 1;
`;

/** Line and column of the first occurrence of `needle`, 1-based like ESLint reports them. */
function at(source: string, needle: string, occurrence = 1): { line: number; column: number } {
  let index = -1;
  for (let n = 0; n < occurrence; n += 1) index = source.indexOf(needle, index + 1);
  if (index < 0) throw new Error(`${needle} not in the source`);
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return { line, column };
}

describe('nameFunction', () => {
  it.each([
    { needle: 'createThing(', expected: 'createThing' },
    { needle: '(msg: string) =>', expected: 'createThing > handle' },
    { needle: '(item) => {', expected: 'createThing > handle > arrow#1' },
    { needle: 'if (item > 1)', expected: 'createThing > handle > arrow#1' },
    { needle: '(item) => item * 2', expected: 'createThing > handle > arrow#2' },
    { needle: 'function (item)', expected: 'createThing > handle > function#1' },
    { needle: 'stop()', expected: 'createThing > stop' },
    { needle: "() => handle('pause')", expected: 'createThing > pause' },
    { needle: "() => handle('quoted')", expected: "createThing > 'quoted-name'" },
    { needle: 'async () => 1', expected: 'helper' },
    { needle: 'const top', expected: 'file' },
  ])('names the function at "$needle" $expected', ({ needle, expected }) => {
    const { line, column } = at(factory, needle);
    expect(nameFunction('factory.ts', factory, line, column)).toBe(expected);
  });

  it('names a file-level finding reported at line 0 "file"', () => {
    expect(nameFunction('factory.ts', factory, 0, 1)).toBe('file');
  });

  it('keeps the name when lines are added above the function', () => {
    const shifted = `// one\n// two\n// three\n${factory}`;
    const { line, column } = at(shifted, '(item) => item * 2');
    expect(nameFunction('factory.ts', shifted, line, column)).toBe(
      'createThing > handle > arrow#2',
    );
  });

  it('reads JSX in a .tsx file', () => {
    const component = `
export function App() {
  return <button onClick={() => console.log('hi')}>hi</button>;
}
`;
    const { line, column } = at(component, "() => console.log('hi')");
    expect(nameFunction('App.tsx', component, line, column)).toBe('App > arrow#1');
  });

  it('names a function from its property key, where ESLint reports a property value function', () => {
    const { line, column } = at(factory, "pause: () => handle('pause')");
    expect(nameFunction('factory.ts', factory, line, column)).toBe('createThing > pause');
    const table = `export const pages = {\n  landing: () => {\n    return 1;\n  },\n};\n`;
    expect(nameFunction('pages.ts', table, 2, 3)).toBe('landing');
  });

  it('names a class constructor and a class property function', () => {
    const source = `export class Track {\n  readonly stop = () => 1;\n  constructor(id: string) {\n    this.id = id;\n  }\n}\n`;
    expect(nameFunction('track.ts', source, 3, 3)).toBe('constructor');
    expect(nameFunction('track.ts', source, 2, 12)).toBe('stop');
  });

  it('names from the source it is given when the same file changed since the last call', () => {
    const before = 'export function first() {\n  return 1;\n}\n';
    const after = 'export function second() {\n  return 2;\n}\n';
    expect(nameFunction('same.ts', before, 2, 3)).toBe('first');
    expect(nameFunction('same.ts', before, 2, 3)).toBe('first');
    expect(nameFunction('same.ts', after, 2, 3)).toBe('second');
    expect(nameFunction('other.ts', before, 2, 3)).toBe('first');
  });

  it('counts anonymous functions per parent, so a sibling elsewhere does not shift the ordinal', () => {
    const source = `
export function a() {
  [1].map((x) => x);
}
export function b() {
  [1].map((x) => x);
  [2].map((x) => x);
}
`;
    const { line, column } = at(source, '(x) => x', 3);
    expect(nameFunction('ab.ts', source, line, column)).toBe('b > arrow#2');
  });
});
