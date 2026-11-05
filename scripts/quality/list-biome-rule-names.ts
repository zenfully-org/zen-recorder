/**
 * Every lint rule a Biome configuration schema (the package's configuration_schema.json) knows, as
 * `group/rule` like `suspicious/noFocusedTests`, in code-unit order. Each group of
 * `$defs.Rules` points, through a `SeverityOr<Group>` choice, at a definition whose properties are
 * the group's own settings (`recommended`, `preset`) and its rules; a rule's property is the one
 * that refers to `<Rule>Configuration`. The schema is the package's only list of its rules.
 */
import { z } from 'zod';

const REF = z.object({ $ref: z.string() });
const NODE = z.object({
  anyOf: z.array(z.unknown()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
const SCHEMA = z.object({
  $defs: z.record(z.string(), z.unknown()).and(z.object({ Rules: NODE })),
});

/** The definitions `node` refers to through `anyOf`, by the last segment of each `$ref`. */
function referenced(defs: Record<string, unknown>, node: unknown): unknown[] {
  return (NODE.parse(node).anyOf ?? [])
    .map((option) => REF.safeParse(option))
    .filter((ref) => ref.success)
    .map((ref) => defs[ref.data.$ref.slice(ref.data.$ref.lastIndexOf('/') + 1)]);
}

/** The group definition behind a group's property: the one with properties, one or two refs away. */
function findGroup(defs: Record<string, unknown>, node: unknown): Record<string, unknown> {
  const choices = referenced(defs, node).flatMap((choice) => [choice, ...referenced(defs, choice)]);
  return choices.map((choice) => NODE.parse(choice).properties).find(Boolean) ?? {};
}

function isRule(name: string, property: unknown): boolean {
  const configuration = `${name.charAt(0).toUpperCase()}${name.slice(1)}Configuration`;
  return (NODE.parse(property).anyOf ?? []).some(
    (option) => REF.safeParse(option).data?.$ref === `#/$defs/${configuration}`,
  );
}

export function listBiomeRuleNames(schema: unknown): string[] {
  const { $defs } = SCHEMA.parse(schema);
  const names = Object.entries($defs.Rules.properties ?? {}).flatMap(([group, node]) =>
    Object.entries(findGroup($defs, node))
      .filter(([name, property]) => isRule(name, property))
      .map(([name]) => `${group}/${name}`),
  );
  if (names.length === 0) {
    throw new Error('The Biome configuration schema names no lint rule under $defs.Rules');
  }
  return names.sort();
}
