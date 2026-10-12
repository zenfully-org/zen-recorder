/**
 * dependency-cruiser's JSON report, with the rules and options of the root's .dependency-cruiser.cjs
 * and the alias of the file its `webpackConfig` names, set up through dependency-cruiser's API as
 * its CLI would: the whole configuration goes in as the rule set, so the API checks it against its
 * schema and refuses an unknown option. The CLI refuses the odd Node.js versions; the API runs on
 * every version this project supports.
 */
import path from 'node:path';
import { allExtensions, cruise, type IConfiguration } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import extractWebpackResolveConfig from 'dependency-cruiser/config-utl/extract-webpack-resolve-config';

/** The extensions dependency-cruiser parses, which are the files it picks when it walks a folder. */
const PARSED = allExtensions.filter((type) => type.available).map((type) => type.extension);

/**
 * The configuration's `exclude` (a regular expression, a list of them, or either as `path`), matched
 * against the path relative to the root, as dependency-cruiser matches it.
 */
function excludedPatterns(options: IConfiguration['options']): RegExp[] {
  const exclude = options?.exclude;
  const paths = typeof exclude === 'string' || Array.isArray(exclude) ? exclude : exclude?.path;
  return [paths ?? []].flat().map((pattern) => new RegExp(pattern));
}

/**
 * The report on these files of `root`, relative to it, and on what they import. Only the files
 * dependency-cruiser parses and its configuration does not exclude go in: handed a file, it cruises
 * it whatever its extension, and it applies `exclude` only to what it finds walking a folder or
 * following an import (its report then drops an excluded file it was handed, but not what that
 * file imports).
 */
export async function cruiseFiles(root: string, files: string[]): Promise<string> {
  const config = await extractDepcruiseConfig(path.join(root, '.dependency-cruiser.cjs'));
  const aliases = config.options?.webpackConfig?.fileName;
  const resolveOptions =
    aliases === undefined ? {} : await extractWebpackResolveConfig(path.join(root, aliases));
  const excluded = excludedPatterns(config.options);
  const { output } = await cruise(
    files.filter(
      (file) =>
        PARSED.some((extension) => file.endsWith(extension)) &&
        !excluded.some((pattern) => pattern.test(file)),
    ),
    { ruleSet: config, validate: true, baseDir: root, outputType: 'json' },
    resolveOptions,
  );
  if (typeof output !== 'string') throw new Error('dependency-cruiser returned no JSON report');
  return output;
}
