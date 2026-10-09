import type { ProviderId } from '@/lib/types';
import { getMeetDescriptor } from './meet/get-meet-descriptor';
import { getTeamsDescriptor } from './teams/get-teams-descriptor';
import type { ProviderDescriptor } from './types';
import { getZoomDescriptor } from './zoom/get-zoom-descriptor';

/** The descriptor of provider `id`, for code that knows a recording's provider by its id. */
export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  switch (id) {
    case 'meet':
      return getMeetDescriptor();
    case 'zoom':
      return getZoomDescriptor();
    case 'teams':
      return getTeamsDescriptor();
  }
}
