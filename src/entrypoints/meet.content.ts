/**
 * ISOLATED-world content script for Google Meet (meet.google.com): the bridge between the page recorder and the
 * background, plus the REC overlay. All logic is in the shared `runBridge`.
 */
// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { defineContentScript } from '#imports';
import { getMeetDescriptor } from '@/lib/providers/meet/get-meet-descriptor';
import { runBridge } from '@/wiring/run-bridge';

export default defineContentScript({
  matches: getMeetDescriptor().origins,
  runAt: 'document_start',
  main: (ctx) => runBridge(ctx, { descriptor: getMeetDescriptor() }),
});
