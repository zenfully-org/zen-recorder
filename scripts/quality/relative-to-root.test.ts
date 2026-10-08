// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { relativeToRoot } from './relative-to-root';

describe('relativeToRoot', () => {
  it.each([
    { file: '/work/repo/src/a.ts', root: '/work/repo', expected: 'src/a.ts' },
    { file: '/work/repo/src/a.ts', root: '/work/repo/', expected: 'src/a.ts' },
    { file: 'C:\\work\\repo\\src\\a.ts', root: 'C:\\work\\repo', expected: 'src/a.ts' },
    { file: '/elsewhere/a.ts', root: '/work/repo', expected: '/elsewhere/a.ts' },
    { file: 'src/a.ts', root: '/work/repo', expected: 'src/a.ts' },
  ])('$file under $root is $expected', ({ file, root, expected }) => {
    expect(relativeToRoot(file, root)).toBe(expected);
  });
});
