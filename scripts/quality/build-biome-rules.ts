/**
 * biome-rules.json's content from what `biome explain` said of every rule of Biome `version`:
 * each rule's own level, and per domain its packages, the rules it recommends and its other
 * rules, all in code-unit order so that a new Biome's file differs only where Biome does.
 * Nursery rules are left out of the domains: Biome turns one on only when the configuration names
 * it, never through `linter.domains` (measured on Biome 2.6.3 with `"recommended"` and `"all"`).
 */
import type { ExplainedRule } from './parse-biome-explain';
import type { BiomeRules } from './read-biome-rules';

type Domain = BiomeRules['domains'][string];

export function buildBiomeRules(version: string, explained: readonly ExplainedRule[]): BiomeRules {
  const sorted = [...explained].sort((a, b) => (a.name < b.name ? -1 : 1));
  const domains = new Map<string, Domain>();
  for (const rule of sorted) {
    for (const { name, recommended, dependencies } of rule.domains) {
      const domain = domains.get(name) ?? { dependencies, recommended: [], others: [] };
      if (domain.dependencies.join() !== dependencies.join()) {
        throw new Error(
          `The domain ${name} names ${domain.dependencies.join(', ')}, and ${rule.name} names ${dependencies.join(', ')}`,
        );
      }
      if (!rule.name.startsWith('nursery/')) {
        (recommended ? domain.recommended : domain.others).push(rule.name);
      }
      domains.set(name, domain);
    }
  }
  return {
    biome: version,
    levels: Object.fromEntries(sorted.map((rule) => [rule.name, rule.level])),
    domains: Object.fromEntries([...domains].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}
