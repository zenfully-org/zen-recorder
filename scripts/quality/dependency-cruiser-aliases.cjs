// WXT's import alias `@` → src/, for dependency-cruiser (.dependency-cruiser.cjs, `webpackConfig`),
// which reads aliases from a webpack-style `resolve.alias`. The project has no webpack: this file
// is the alias and nothing else. WXT defines the same alias for the build, Vitest and TypeScript.
const path = require('node:path');

module.exports = { resolve: { alias: { '@': path.join(__dirname, '..', '..', 'src') } } };
