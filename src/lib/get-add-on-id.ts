// Imports nothing on purpose: wxt.config.ts loads this file without the "@" alias.

/**
 * The add-on's id, which Firefox and AMO key everything on: updates, signing, storage, permissions
 * and the `moz-extension://` UUID. An add-on with another id is another add-on, so this never
 * changes. It is also the namespace of the page ↔ bridge messages.
 */
export function getAddOnId(): string {
  return 'zen-recorder@zenfully-org.github.io';
}
