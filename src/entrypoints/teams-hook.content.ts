/**
 * MAIN-world content script for Microsoft Teams on the web: the recorder itself. All logic is in the shared
 * `runPageRecorder`; this file only says where it runs and with which provider.
 */
// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { defineContentScript } from '#imports';
import { createTeamsProvider } from '@/lib/providers/teams/create-teams-provider';
import { getTeamsDescriptor } from '@/lib/providers/teams/get-teams-descriptor';
import { runPageRecorder } from '@/wiring/run-page-recorder';

export default defineContentScript({
  matches: getTeamsDescriptor().origins,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    runPageRecorder({ descriptor: getTeamsDescriptor(), createProvider: createTeamsProvider });
  },
});
