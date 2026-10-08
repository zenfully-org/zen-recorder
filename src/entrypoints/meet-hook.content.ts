/**
 * MAIN-world content script for Google Meet (meet.google.com): the recorder itself. All logic is in the shared
 * `runPageRecorder`; this file only says where it runs and with which provider.
 */
// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { defineContentScript } from '#imports';
import { createMeetProvider } from '@/lib/providers/meet/create-meet-provider';
import { getMeetDescriptor } from '@/lib/providers/meet/get-meet-descriptor';
import { runPageRecorder } from '@/wiring/run-page-recorder';

export default defineContentScript({
  matches: getMeetDescriptor().origins,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    runPageRecorder({ descriptor: getMeetDescriptor(), createProvider: createMeetProvider });
  },
});
