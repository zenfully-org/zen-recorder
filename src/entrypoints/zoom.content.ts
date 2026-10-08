/**
 * ISOLATED-world content script for Zoom's web client: the bridge between the page recorder and the
 * background, plus the REC overlay. All logic is in the shared `runBridge`.
 */
// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { defineContentScript } from '#imports';
import { getZoomDescriptor } from '@/lib/providers/zoom/get-zoom-descriptor';
import { runBridge } from '@/wiring/run-bridge';

export default defineContentScript({
  matches: getZoomDescriptor().origins,
  runAt: 'document_start',
  main: (ctx) => runBridge(ctx, { descriptor: getZoomDescriptor() }),
});
