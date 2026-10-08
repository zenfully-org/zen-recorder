/**
 * Prints dependency-cruiser's JSON report on the folders given as arguments, with the rules and
 * options of .dependency-cruiser.cjs and the alias of the file its `webpackConfig` names, set up
 * through dependency-cruiser's API as its CLI would: the whole configuration goes in as the rule
 * set, so the API checks it against its schema and refuses an unknown option. The CLI refuses the
 * odd Node.js versions; the API runs on every version this project supports. check-quality.ts
 * runs this file as a child process, so the cruise (about a second) runs while ESLint lints in the
 * parent. On a failure it prints the message to standard error and exits with 1.
 * Usage: `node --import tsx scripts/quality/cruise-imports.ts src scripts`.
 */
import path from 'node:path';
import { cruise } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import extractWebpackResolveConfig from 'dependency-cruiser/config-utl/extract-webpack-resolve-config';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

async function main(): Promise<void> {
  const config = await extractDepcruiseConfig(path.join(ROOT, '.dependency-cruiser.cjs'));
  const aliases = config.options?.webpackConfig?.fileName;
  const resolveOptions =
    aliases === undefined ? {} : await extractWebpackResolveConfig(path.join(ROOT, aliases));
  const { output } = await cruise(
    process.argv.slice(2),
    { ruleSet: config, validate: true, baseDir: ROOT, outputType: 'json' },
    resolveOptions,
  );
  if (typeof output !== 'string') throw new Error('dependency-cruiser returned no JSON report');
  process.stdout.write(output);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
