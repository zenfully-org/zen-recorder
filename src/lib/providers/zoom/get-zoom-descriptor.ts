import type { ProviderDescriptor } from '../types';

/** Static facts about Zoom's web client (`app.zoom.us/wc/…` and account subdomains). */
export function getZoomDescriptor(): ProviderDescriptor {
  return {
    id: 'zoom',
    label: 'Zoom',
    origins: ['https://*.zoom.us/*'],
    fixturePrefix: '/zoom',
    fixtureHostname: 'app.zoom.us',
  };
}
