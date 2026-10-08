/**
 * MAIN-world content script for Zoom's web client: the recorder itself. All logic is in the shared
 * `runPageRecorder`; this file only says where it runs and with which provider.
 */
// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { defineContentScript } from '#imports';
import { createZoomProvider } from '@/lib/providers/zoom/create-zoom-provider';
import { getZoomDescriptor } from '@/lib/providers/zoom/get-zoom-descriptor';
import { runPageRecorder } from '@/wiring/run-page-recorder';

export default defineContentScript({
  matches: getZoomDescriptor().origins,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    runPageRecorder({ descriptor: getZoomDescriptor(), createProvider: createZoomProvider });
  },
});
