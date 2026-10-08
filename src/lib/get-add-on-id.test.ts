import { describe, expect, it } from 'vitest';
import { getAddOnId } from './get-add-on-id';

describe('getAddOnId', () => {
  it('is the published id, which names the project and nobody', () => {
    // Firefox treats an add-on with another id as another add-on: a change after a release breaks
    // every user's updates and leaves their settings behind.
    expect(getAddOnId()).toBe('zen-recorder@zenfully-org.github.io');
  });
});
