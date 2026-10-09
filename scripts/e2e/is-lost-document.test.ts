import { describe, expect, it } from 'vitest';
import { isLostDocument } from './is-lost-document';

describe('isLostDocument', () => {
  it.each([
    // The evaluation ran in the next document before its fixture script did.
    [new TypeError(`can't access property "probe", window.__fixture is undefined`)],
    [new Error('Protocol error (script.callFunction): no such frame')],
    [new Error('Protocol error (script.callFunction): no such realm')],
    [new Error('Execution context was destroyed, most likely because of a navigation.')],
    [new Error('Navigating frame was detached')],
  ])('takes %s for a document a navigation took away', (error) => {
    expect(isLostDocument(error)).toBe(true);
  });

  it.each([
    [new Error('the probe store:hold-next-chunk failed')],
    [new TypeError(`can't access property "snapshot", window.__zenRecorderPage is undefined`)],
    ['not an error'],
    [undefined],
  ])('takes %s for a failure of its own', (error) => {
    expect(isLostDocument(error)).toBe(false);
  });
});
