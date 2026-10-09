// Relative imports only: wxt.config.ts loads this file without the "@" alias.
import { listTestBuildModules } from './list-test-build-modules';

/** A chunk as the bundler renders it: each module it holds, and how much of its code it ships. */
export interface RenderedChunk {
  modules: Readonly<Record<string, { renderedLength: number }>>;
}

/**
 * The test-build modules (`listTestBuildModules`) whose code `chunks` ship, as paths relative to the
 * project. A release build must ship none: reviewers on addons.mozilla.org read the shipped code,
 * and probes that click the popup or faults that fail every save are hard to review even where
 * nothing can run them. A module the bundler kept in a chunk but whose code it dropped entirely
 * ships nothing, so it is not counted.
 */
export function findTestBuildModules(chunks: Iterable<RenderedChunk>): string[] {
  const listed = listTestBuildModules();
  const shipped = new Set<string>();
  for (const chunk of chunks) {
    for (const [id, module] of Object.entries(chunk.modules)) {
      // Module ids are absolute, with the platform's separators, and some carry a query.
      const query = id.indexOf('?');
      const file = (query === -1 ? id : id.slice(0, query)).replaceAll('\\', '/');
      const entry = listed.find((candidate) => file.endsWith(`/${candidate}`));
      if (entry !== undefined && module.renderedLength > 0) shipped.add(entry);
    }
  }
  return [...shipped].sort();
}
