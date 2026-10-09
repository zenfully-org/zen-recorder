import { describe, expect, it, vi } from 'vitest';
import { runPopupRequest } from './run-popup-request';

describe('runPopupRequest', () => {
  it('resolves with null when the request goes through', async () => {
    await expect(runPopupRequest('Could not open the settings', async () => true)).resolves.toBe(
      null,
    );
  });

  it('makes the request at once, inside the click that asked for it', () => {
    // `permissions.request` runs only while the page handles the person's input: not one await
    // may come before it.
    const request = vi.fn(async () => undefined);
    void runPopupRequest('Could not ask for access', request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      what: 'a rejection',
      request: () =>
        Promise.reject(
          new Error('permissions.request may only be called from a user input handler'),
        ),
      said: 'Could not ask for access: permissions.request may only be called from a user input handler',
    },
    {
      what: 'a throw before any promise',
      request: () => {
        throw new Error('browser.permissions is undefined');
      },
      said: 'Could not ask for access: browser.permissions is undefined',
    },
    {
      what: 'a rejection that is not an Error',
      request: () => Promise.reject('busy'),
      said: 'Could not ask for access: busy',
    },
  ])('says what failed and why on $what', async ({ request, said }) => {
    await expect(runPopupRequest('Could not ask for access', request)).resolves.toBe(said);
  });
});
