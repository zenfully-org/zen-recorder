// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { listBiomeRuleNames } from './list-biome-rule-names';

const require = createRequire(import.meta.url);

/** A group as the schema writes it: its own settings beside its rules, behind two references. */
const SCHEMA = {
  $defs: {
    Rules: {
      properties: {
        preset: { anyOf: [{ $ref: '#/$defs/PresetConfig' }, { type: 'null' }] },
        recommended: { type: ['boolean', 'null'] },
        suspicious: { anyOf: [{ $ref: '#/$defs/SeverityOrSuspicious' }, { type: 'null' }] },
        a11y: { anyOf: [{ $ref: '#/$defs/SeverityOrA11y' }, { type: 'null' }] },
      },
    },
    SeverityOrSuspicious: {
      anyOf: [{ $ref: '#/$defs/GroupPlainConfiguration' }, { $ref: '#/$defs/Suspicious' }],
    },
    SeverityOrA11y: {
      anyOf: [{ $ref: '#/$defs/GroupPlainConfiguration' }, { $ref: '#/$defs/A11y' }],
    },
    GroupPlainConfiguration: { oneOf: [{ const: 'off' }, { const: 'on' }] },
    PresetConfig: { type: 'string' },
    Suspicious: {
      properties: {
        preset: { anyOf: [{ $ref: '#/$defs/PresetConfig' }, { type: 'null' }] },
        recommended: { type: ['boolean', 'null'] },
        noFocusedTests: {
          anyOf: [{ $ref: '#/$defs/NoFocusedTestsConfiguration' }, { type: 'null' }],
        },
        noDebugger: { anyOf: [{ $ref: '#/$defs/NoDebuggerConfiguration' }, { type: 'null' }] },
      },
    },
    A11y: {
      properties: {
        noAccessKey: { anyOf: [{ $ref: '#/$defs/NoAccessKeyConfiguration' }, { type: 'null' }] },
      },
    },
  },
};

describe('listBiomeRuleNames', () => {
  it('lists the rules of every group as group/rule, sorted, without the groups own settings', () => {
    expect(listBiomeRuleNames(SCHEMA)).toEqual([
      'a11y/noAccessKey',
      'suspicious/noDebugger',
      'suspicious/noFocusedTests',
    ]);
  });

  it('reads the schema the installed Biome ships', () => {
    const schema: unknown = JSON.parse(
      readFileSync(require.resolve('@biomejs/biome/configuration_schema.json'), 'utf8'),
    );
    const names = listBiomeRuleNames(schema);
    expect(names).toContain('suspicious/noFocusedTests');
    expect(names).toContain('correctness/noComponentHookFactories');
    expect(names.filter((name) => !/^[a-z0-9]+\/(?:no|use)[A-Z]\w+$/.test(name))).toEqual([]);
  });

  it('refuses a schema whose groups it cannot find, rather than list no rule', () => {
    expect(() => listBiomeRuleNames({ $defs: { Rules: { properties: {} } } })).toThrow(/rule/);
  });
});
