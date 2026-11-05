/**
 * Writes scripts/quality/biome-rules.json, the lint rules of the installed Biome, which
 * scripts/quality/biome-config.test.ts reads to check the level of every rule biome.jsonc enables,
 * the rules of a domain included: every rule's own level, and each domain's packages, recommended
 * rules and other rules (`readBiomeRules`). It asks `biome explain` about every rule the
 * installed configuration_schema.json names (about 640 processes, as many at once as the machine
 * has cores: a few seconds on 20 cores, about 20 on 2), then formats the file with Biome.
 *
 * Usage: `pnpm quality:biome-rules`, after a Biome update (the test fails until the file names the
 * installed version). Read its diff before committing it: a rule that is new to a domain this
 * project's biome.jsonc names, or whose level dropped, is what the update brings to `pnpm check`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { buildBiomeRules } from './build-biome-rules';
import { listBiomeRuleNames } from './list-biome-rule-names';
import { type ExplainedRule, parseBiomeExplain } from './parse-biome-explain';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const biome = require.resolve('@biomejs/biome/bin/biome');
const target = path.join(import.meta.dirname, 'biome-rules.json');

async function explain(name: string): Promise<ExplainedRule> {
  const rule = name.slice(name.indexOf('/') + 1);
  const { stdout } = await run(process.execPath, [biome, 'explain', rule], { encoding: 'utf8' });
  const explained = parseBiomeExplain(stdout);
  if (explained.name !== name) throw new Error(`biome explain ${rule} explained ${explained.name}`);
  return explained;
}

const { version } = z.object({ version: z.string() }).parse(require('@biomejs/biome/package.json'));
const names = listBiomeRuleNames(
  JSON.parse(readFileSync(require.resolve('@biomejs/biome/configuration_schema.json'), 'utf8')),
);
const queue = [...names];
const explained: ExplainedRule[] = [];
await Promise.all(
  Array.from({ length: availableParallelism() }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) explained.push(await explain(name));
  }),
);
writeFileSync(target, `${JSON.stringify(buildBiomeRules(version, explained), null, 2)}\n`);
execFileSync(process.execPath, [biome, 'format', '--write', target], { stdio: 'inherit' });
console.log(
  `wrote ${path.relative(process.cwd(), target)}: ${names.length} rules of Biome ${version}`,
);
