/**
 * `globalThis` where it reaches one of zod's own globals: `globalThis.__zod_globalConfig`,
 * `globalThis?.__zod_x`, and `(_a = globalThis).__zod_x`, the form TypeScript compiles `??=` to.
 */
const ZOD_GLOBAL_ACCESS = /\bglobalThis(?=\)?\s*\??\.\s*__zod_)/g;

/**
 * Points zod's own globals at `holder`, or returns null when the code reaches none. zod keeps its
 * settings and its global registry on `globalThis`, which in a hook script is the meeting page's
 * window; the other uses of `globalThis` are left alone.
 */
export function rewriteZodGlobals(code: string, holder: string): string | null {
  const rewritten = code.replace(ZOD_GLOBAL_ACCESS, holder);
  return rewritten === code ? null : rewritten;
}
