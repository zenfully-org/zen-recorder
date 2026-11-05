// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBiomeRules } from './read-biome-rules';

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-biome-catalog-')));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('readBiomeRules', () => {
  it('reads the levels and the domains biome-rules.json holds', () => {
    const file = path.join(folder, 'biome-rules.json');
    const rules = {
      biome: '2.6.3',
      levels: { 'suspicious/noFocusedTests': 'warn' },
      domains: {
        test: {
          dependencies: ['vitest@>=1.0.0'],
          recommended: ['suspicious/noFocusedTests'],
          others: [],
        },
      },
    };
    writeFileSync(file, JSON.stringify(rules));
    expect(readBiomeRules(file)).toEqual(rules);
  });

  it('reads the file next to it by default', () => {
    const rules = readBiomeRules();
    expect(rules.levels['suspicious/noFocusedTests']).toBe('warn');
    expect(rules.domains['test']?.recommended).toContain('suspicious/noFocusedTests');
  });

  it('refuses a file that is not what the generator writes, naming it', () => {
    const file = path.join(folder, 'biome-rules.json');
    writeFileSync(file, JSON.stringify({ biome: '2.6.3', levels: { 'style/useConst': 'loud' } }));
    expect(() => readBiomeRules(file)).toThrow(/biome-rules\.json/);
  });
});
