// Relative imports on purpose: wxt.config.ts loads this file without the "@" alias.
import { getMeetDescriptor } from './meet/get-meet-descriptor';
import { getTeamsDescriptor } from './teams/get-teams-descriptor';
import type { ProviderDescriptor } from './types';
import { getZoomDescriptor } from './zoom/get-zoom-descriptor';

/** Every supported meeting service: the single list the manifest, popup and fixtures read. */
export function getProviderCatalog(): ProviderDescriptor[] {
  return [getMeetDescriptor(), getZoomDescriptor(), getTeamsDescriptor()];
}
