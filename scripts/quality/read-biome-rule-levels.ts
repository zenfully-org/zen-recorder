/**
 * The level at which Biome reports each lint rule it enables for the folder `root`, where its
 * biome.jsonc applies it. The rules are those `biome rage --linter` lists (the preset's, the ones
 * the configuration names and a domain's named `"all"`), the ones each domain `linter.domains`
 * names turns on (rage lists none of a domain named `"recommended"`) unless the configuration
 * turns them off, and the ones an override turns on. A
 * rule's level is the one the configuration gives it, or else its own (`rules.levels`); where an
 * override names another, the lower of the two. A rule's entry is its level (`on` keeps its own),
 * alone or beside its options. A level on a whole group (`"style": "error"`) turns on every rule
 * of the group, recommended or not, so biome.jsonc sets levels rule by rule, and a group written
 * as a level fails to parse here; so does an override that names domains or a preset, which this
 * does not read.
 */
import path from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { listEnabledBiomeRules } from './list-enabled-biome-rules';
import type { BiomeRules } from './read-biome-rules';

const LEVELS = ['info', 'warn', 'error'] as const;
const LEVEL = z.enum(LEVELS);
type Level = z.infer<typeof LEVEL>;
const SETTING = z.union([z.enum(['on', 'off']), LEVEL]);
const RULE = z
  .union([SETTING, z.object({ level: SETTING })])
  .transform((rule) => (typeof rule === 'string' ? rule : rule.level));
/** A group's rules, beside its own `recommended` or `preset`. */
const GROUP = z.record(z.string(), z.unknown());
const RULES = z.record(z.string(), z.unknown());
const CONFIG = z.object({
  linter: z
    .object({
      rules: RULES.optional(),
      domains: z.record(z.string(), z.enum(['recommended', 'all', 'none'])).optional(),
    })
    .optional(),
  overrides: z
    .array(
      z.object({
        linter: z
          .object({
            rules: z.record(z.string(), z.record(z.string(), RULE)).optional(),
            domains: z
              .never({ error: 'an override that names domains is not read here' })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
type Config = z.infer<typeof CONFIG>;

/** biome.jsonc, comments and trailing commas allowed, read as TypeScript reads its own JSONC. */
function readConfig(file: string): Config {
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  }
  const parsed = CONFIG.safeParse(config);
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`);
  return parsed.data;
}

/** What biome.jsonc says of `name` (`group/rule`), if it names the rule. */
function readSetting(rules: Record<string, unknown>, name: string) {
  const [group = '', rule = ''] = name.split('/');
  return RULE.optional().parse(GROUP.optional().parse(rules[group])?.[rule]);
}

/** The rules each domain the configuration names turns on, before the configuration's own say. */
function listDomainRules(config: Config, rules: BiomeRules): string[] {
  return Object.entries(config.linter?.domains ?? {}).flatMap(([name, value]) => {
    const domain = rules.domains[name];
    if (!domain) throw new Error(`biome-rules.json knows no domain ${name}`);
    if (value === 'none') return [];
    return value === 'all' ? [...domain.recommended, ...domain.others] : domain.recommended;
  });
}

/** Each rule an override turns on (`group/rule`), with the setting it gives it there. */
function listOverrideSettings(config: Config): [string, string][] {
  return (config.overrides ?? []).flatMap((override) =>
    Object.entries(override.linter?.rules ?? {}).flatMap(([group, settings]) =>
      Object.entries(settings)
        .filter(([, setting]) => setting !== 'off')
        .map(([rule, setting]): [string, string] => [`${group}/${rule}`, setting]),
    ),
  );
}

export function readBiomeRuleLevels(root: string, rules: BiomeRules): Map<string, Level> {
  const config = readConfig(path.join(root, 'biome.jsonc'));
  const named = config.linter?.rules ?? {};
  const levelOf = (name: string, setting: string | undefined): Level => {
    const level = LEVEL.safeParse(setting).data ?? rules.levels[name];
    if (!level) throw new Error(`biome-rules.json knows no rule ${name}`);
    return level;
  };
  const enabled = [
    ...listEnabledBiomeRules(root),
    ...listDomainRules(config, rules).filter((name) => readSetting(named, name) !== 'off'),
  ];
  const levels = new Map(enabled.map((name) => [name, levelOf(name, readSetting(named, name))]));
  for (const [name, setting] of listOverrideSettings(config)) {
    const level = levelOf(name, setting);
    const before = levels.get(name) ?? 'error';
    levels.set(name, LEVELS.indexOf(level) < LEVELS.indexOf(before) ? level : before);
  }
  return levels;
}
