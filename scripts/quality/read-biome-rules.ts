/**
 * Biome's lint rules as biome-rules.json holds them: the Biome release they were read from
 * (`biome`), every rule's own level (`levels`, `group/rule` → level), and for each domain the
 * packages that turn it on, the rules `"<domain>": "recommended"` turns on (`recommended`) and the
 * ones `"all"` adds (`others`). `pnpm quality:biome-rules` writes the file from the installed
 * Biome, which has no list of a domain's rules and tells a rule's level only through one
 * `biome explain` per rule.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const LEVEL = z.enum(['info', 'warn', 'error']);
const NAMES = z.array(z.string());
const BIOME_RULES = z.strictObject({
  biome: z.string(),
  levels: z.record(z.string(), LEVEL),
  domains: z.record(
    z.string(),
    z.strictObject({ dependencies: NAMES, recommended: NAMES, others: NAMES }),
  ),
});

export type BiomeRules = z.infer<typeof BIOME_RULES>;

export function readBiomeRules(
  file = path.join(import.meta.dirname, 'biome-rules.json'),
): BiomeRules {
  const parsed = BIOME_RULES.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${file} is not what pnpm quality:biome-rules writes: ${parsed.error.message}`);
  }
  return parsed.data;
}
