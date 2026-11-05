/**
 * What `biome explain <rule>` says of a lint rule: its name with its group (from its diagnostic
 * category, `lint/<group>/<rule>`), its default level, and its domains. Biome has no
 * machine-readable form of it. The text opens with a "Summary" list; a rule of a domain has a
 * "Domains" section next, a block per domain: "- Name: <domain>", then "The rule is recommended
 * for this domain" when it is, and the packages that turn the domain on, each on an indented
 * "  - <package>@<range>" line (as are the globals the domain adds, which are not read). Every
 * section starts at a heading line of its own ("Summary", "Domains", "Description", ...).
 */
import { z } from 'zod';

const LEVEL = z.enum(['info', 'warn', 'error']);

export interface ExplainedRule {
  /** `group/rule`, like `suspicious/noFocusedTests`. */
  name: string;
  level: z.infer<typeof LEVEL>;
  domains: { name: string; recommended: boolean; dependencies: string[] }[];
}

const HEADING = /^[A-Z][a-z]+$/;

/** The lines of the section under `heading`, up to the next heading. */
function section(lines: readonly string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

function readDomains(lines: readonly string[]): ExplainedRule['domains'] {
  const domains: ExplainedRule['domains'] = [];
  let listing: string[] | undefined;
  for (const line of lines) {
    const name = /^- Name: (\w+)$/.exec(line)?.[1];
    const item = /^ {2}- (\S+)$/.exec(line)?.[1];
    const domain = domains.at(-1);
    if (name) {
      domains.push({ name, recommended: false, dependencies: [] });
      listing = undefined;
    } else if (domain && line.startsWith('- ')) {
      domain.recommended ||= line === '- The rule is recommended for this domain';
      listing = line.startsWith('- The rule is enabled when') ? domain.dependencies : undefined;
    } else if (item) {
      listing?.push(item);
    }
  }
  return domains;
}

export function parseBiomeExplain(text: string): ExplainedRule {
  const lines = text.split(/\r?\n/);
  const summary = section(lines, 'Summary').join('\n');
  const category = /^- Diagnostic category: lint\/(\w+\/\w+)$/m.exec(summary)?.[1];
  const level = LEVEL.safeParse(/^- Default severity: (\w+)$/m.exec(summary)?.[1]);
  if (!category || !level.success) {
    throw new Error(`Not the explanation of a lint rule:\n${text.slice(0, 500)}`);
  }
  return { name: category, level: level.data, domains: readDomains(section(lines, 'Domains')) };
}
