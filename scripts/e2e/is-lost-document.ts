/**
 * Whether an evaluation in a test page failed because the page was between two documents: the
 * fake Zoom page navigates a second after a call ends, as the real client does. The evaluation
 * then either lost its document (Puppeteer's errors for a frame or realm that is gone) or ran in
 * the next one before that document's fixture script had set `window.__fixture`.
 */
const LOST_DOCUMENT_RE =
  /window\.__fixture is undefined|no such (frame|realm)|context was destroyed|frame was detached/i;

export function isLostDocument(error: unknown): boolean {
  return error instanceof Error && LOST_DOCUMENT_RE.test(error.message);
}
