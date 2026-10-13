/**
 * The level at which Biome reports each lint rule it enables for the folder `root`: the level the
 * folder's biome.jsonc gives the rule, or else the rule's default, which only `biome explain <rule>`
 * says. A rule's entry is its level (`on` keeps the default), alone or beside its options. A level
 * on a whole group (`"style": "error"`) turns on every rule of the group, recommended or not, so
 * biome.jsonc sets levels rule by rule, and a group written as a level fails to parse here.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { z } from 'zod';
import { listEnabledBiomeRules } from './list-enabled-biome-rules';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

const LEVEL = z.enum(['info', 'warn', 'error']);
type Level = z.infer<typeof LEVEL>;
const SETTING = z.union([z.enum(['on', 'off']), LEVEL]);
const RULE = z
  .union([SETTING, z.object({ level: SETTING })])
  .transform((rule) => (typeof rule === 'string' ? rule : rule.level));
/** A group's rules, beside its own `recommended` or `preset`. */
const GROUP = z.record(z.string(), z.unknown());
const CONFIG = z.object({
  linter: z.object({ rules: z.record(z.string(), z.unknown()).optional() }).optional(),
});

/** biome.jsonc, comments and trailing commas allowed, read as TypeScript reads its own JSONC. */
function readConfig(root: string): z.infer<typeof CONFIG> {
  const file = path.join(root, 'biome.jsonc');
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  }
  return CONFIG.parse(config);
}

/** What biome.jsonc says of `name` (`group/rule`), if it names the rule. */
function readSetting(rules: Record<string, unknown>, name: string) {
  const [group = '', rule = ''] = name.split('/');
  return RULE.optional().parse(GROUP.optional().parse(rules[group])?.[rule]);
}

async function readDefaultLevel(biome: string, name: string): Promise<Level> {
  const rule = name.slice(name.indexOf('/') + 1);
  const { stdout } = await run(process.execPath, [biome, 'explain', rule], { encoding: 'utf8' });
  return LEVEL.parse(/^- Default severity: (\w+)$/m.exec(stdout)?.[1]);
}

/**
 * `task` for every item, in order, as many at once as the machine has cores: one `biome explain`
 * after the other, the defaults of the 130-odd recommended rules took 12 s.
 */
async function mapPooled<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const queue = items.map((item, index) => ({ item, index }));
  const done: { index: number; result: R }[] = [];
  const work = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      done.push({ index: next.index, result: await task(next.item) });
    }
  };
  await Promise.all(Array.from({ length: availableParallelism() }, work));
  return done.sort((a, b) => a.index - b.index).map(({ result }) => result);
}

export async function readBiomeRuleLevels(root: string): Promise<Map<string, Level>> {
  const biome = require.resolve('@biomejs/biome/bin/biome');
  const rules = readConfig(root).linter?.rules ?? {};
  const levelOf = async (name: string): Promise<Level> => {
    const named = LEVEL.safeParse(readSetting(rules, name));
    return named.success ? named.data : readDefaultLevel(biome, name);
  };
  const enabled = listEnabledBiomeRules(root);
  return new Map(await mapPooled(enabled, async (name) => [name, await levelOf(name)] as const));
}
