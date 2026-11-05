// @vitest-environment node
import { buildBiomeRules } from './build-biome-rules';

const VITEST = ['vitest@>=1.0.0'];
const REACT = ['react@>=16.0.0'];

describe('buildBiomeRules', () => {
  it('gives every rule its default level, and each domain the rules each of its values turns on', () => {
    const rules = buildBiomeRules('2.6.3', [
      {
        name: 'suspicious/noSkippedTests',
        level: 'warn',
        domains: [{ name: 'test', recommended: false, dependencies: VITEST }],
      },
      {
        name: 'suspicious/noFocusedTests',
        level: 'warn',
        domains: [{ name: 'test', recommended: true, dependencies: VITEST }],
      },
      { name: 'suspicious/noDebugger', level: 'error', domains: [] },
      {
        name: 'performance/noSyncScripts',
        level: 'warn',
        domains: [
          { name: 'react', recommended: false, dependencies: REACT },
          { name: 'next', recommended: false, dependencies: ['next@>=14.0.0'] },
        ],
      },
      {
        name: 'correctness/noChildrenProp',
        level: 'error',
        domains: [{ name: 'react', recommended: true, dependencies: REACT }],
      },
    ]);
    expect(rules).toEqual({
      biome: '2.6.3',
      levels: {
        'correctness/noChildrenProp': 'error',
        'performance/noSyncScripts': 'warn',
        'suspicious/noDebugger': 'error',
        'suspicious/noFocusedTests': 'warn',
        'suspicious/noSkippedTests': 'warn',
      },
      domains: {
        next: {
          dependencies: ['next@>=14.0.0'],
          recommended: [],
          others: ['performance/noSyncScripts'],
        },
        react: {
          dependencies: REACT,
          recommended: ['correctness/noChildrenProp'],
          others: ['performance/noSyncScripts'],
        },
        test: {
          dependencies: VITEST,
          recommended: ['suspicious/noFocusedTests'],
          others: ['suspicious/noSkippedTests'],
        },
      },
    });
    expect(Object.keys(rules.levels)).toEqual(Object.keys(rules.levels).sort());
    expect(Object.keys(rules.domains)).toEqual(['next', 'react', 'test']);
  });

  it('keeps a nursery rule out of its domains, which no value of linter.domains turns on', () => {
    const rules = buildBiomeRules('2.6.3', [
      {
        name: 'nursery/noTailwindLegacyUtilities',
        level: 'warn',
        domains: [{ name: 'tailwind', recommended: true, dependencies: ['tailwindcss@>=4.0.0'] }],
      },
    ]);
    expect(rules.levels).toEqual({ 'nursery/noTailwindLegacyUtilities': 'warn' });
    expect(rules.domains).toEqual({
      tailwind: { dependencies: ['tailwindcss@>=4.0.0'], recommended: [], others: [] },
    });
  });

  it('refuses a domain whose rules name different packages, rather than pick one', () => {
    expect(() =>
      buildBiomeRules('2.6.3', [
        {
          name: 'suspicious/noFocusedTests',
          level: 'warn',
          domains: [{ name: 'test', recommended: true, dependencies: VITEST }],
        },
        {
          name: 'suspicious/noSkippedTests',
          level: 'warn',
          domains: [{ name: 'test', recommended: false, dependencies: ['jest@>=26.0.0'] }],
        },
      ]),
    ).toThrow(/test.*noSkippedTests/);
  });
});
