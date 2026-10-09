// Relative imports only: wxt.config.ts loads this file without the "@" alias.
import { rewriteZodGlobals } from './rewrite-zod-globals';

/** What the plugin reads of a built file: a chunk's name and code. */
type BuiltFile = { type: 'asset' } | { type: 'chunk'; fileName: string; code: string };

/** The module every rewritten zod module imports its globals from: one object per bundle. */
const HOLDER_MODULE = 'virtual:zen-recorder/zod-globals';
const RESOLVED_HOLDER_MODULE = `\0${HOLDER_MODULE}`;
const HOLDER = '__zenRecorderZodGlobals';
const ZOD_MODULE = /[\\/]node_modules[\\/]zod[\\/]/;
/** `globalThis` right before a zod global, however the minifier wrote the access. */
const ZOD_GLOBAL_READ = /globalThis\W{0,4}__zod_/;

/**
 * A Vite plugin for every build: zod keeps its settings (`__zod_globalConfig`) and its global
 * registry (`__zod_globalRegistry`) on `globalThis`, which in a hook script is the meeting page's
 * window. The page could read them, change the recorder's parsers through them (turn the
 * interpreted mode off, add a post-processor zod hands every new schema to), and a zod the page
 * loads itself would take the recorder's settings. The plugin gives each bundle's zod an object of
 * its own instead, and the build fails when a bundle still reaches a zod global through
 * `globalThis`, for instance after a zod update that the rewrite no longer matches.
 */
export function createPrivateZodGlobalsPlugin() {
  return {
    name: 'zen-recorder:private-zod-globals',
    resolveId(id: string): string | null {
      return id === HOLDER_MODULE ? RESOLVED_HOLDER_MODULE : null;
    },
    load(id: string): string | null {
      return id === RESOLVED_HOLDER_MODULE ? 'export default {};' : null;
    },
    transform(code: string, id: string): { code: string } | null {
      if (!ZOD_MODULE.test(id)) return null;
      const rewritten = rewriteZodGlobals(code, HOLDER);
      // Imports are hoisted: at the end, the import moves no line of zod's code.
      return rewritten === null
        ? null
        : { code: `${rewritten}\nimport ${HOLDER} from '${HOLDER_MODULE}';\n` };
    },
    generateBundle(
      this: { error: (message: string) => never },
      _options: unknown,
      bundle: Readonly<Record<string, BuiltFile>>,
    ): void {
      const reaching = Object.values(bundle).flatMap((file) =>
        file.type === 'chunk' && ZOD_GLOBAL_READ.test(file.code) ? [file.fileName] : [],
      );
      if (reaching.length === 0) return;
      this.error(
        `${reaching.join(', ')} reaches zod's globals through globalThis, which in a hook script is the meeting page's window: make scripts/build/rewrite-zod-globals.ts match the code that reaches them`,
      );
    },
  };
}
