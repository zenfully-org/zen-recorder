// The import rules of the quality gate (`pnpm check:quality`, scripts/check-quality.ts), checked
// by dependency-cruiser over src/ and scripts/. Every rule here fails the check, and none has a
// baseline: the code breaks none of them.
//
// The check reads this file through dependency-cruiser's API (scripts/quality/cruise-imports.ts),
// which runs on every Node.js version the project supports. By hand,
// `pnpm exec depcruise src scripts --config .dependency-cruiser.cjs` prints what breaks the rules,
// on an even Node.js version: that command refuses the odd ones.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Two modules that import each other, directly or through others, cannot be understood, ' +
        'tested or loaded one without the other, and a cycle through a create* factory and the ' +
        'module it returns creeps in unnoticed. Break it by moving what both need into a module ' +
        'of its own. Type-only imports count too: they couple the modules for a reader all the same.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'A relative or `@/` import dependency-cruiser cannot resolve hides every cycle through it. ' +
        'TypeScript would already refuse a file that does not exist, so this one fails when ' +
        'dependency-cruiser resolves imports differently from TypeScript: fix the resolution here.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, path: '^(\\.|@/)' },
    },
  ],
  options: {
    // Packages are part of no cycle of ours: note the import, do not read the package.
    doNotFollow: { path: 'node_modules' },
    // Fixture pages and the generated UI components are not the project's own modules.
    exclude: { path: '^src/(test/fixtures|components/ui)/' },
    // Read the TypeScript source, so `import type` is a dependency too (it disappears once
    // compiled to JavaScript).
    tsPreCompilationDeps: true,
    moduleSystems: ['es6'],
    // Compute only what the rules above need (cycles), which keeps the run short.
    skipAnalysisNotInRules: true,
    // WXT's `@` alias for src/. WXT writes it into .wxt/tsconfig.json as `../src/*`, relative to
    // .wxt/; the tsconfig-paths plugin dependency-cruiser uses for `tsConfig` reads such paths
    // relative to the root instead and resolves none of them. A webpack-style `resolve.alias` in
    // its own file is the other way dependency-cruiser takes an alias.
    webpackConfig: { fileName: 'scripts/quality/dependency-cruiser-aliases.cjs' },
  },
};
