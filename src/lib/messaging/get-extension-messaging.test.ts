import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '#imports';
import { getExtensionMessaging } from './get-extension-messaging';

describe('getExtensionMessaging', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns a memoized instance', () => {
    expect(getExtensionMessaging()).toBe(getExtensionMessaging());
  });

  it('round-trips a typed request through the fake browser runtime', async () => {
    const { sendMessage, onMessage, removeAllListeners } = getExtensionMessaging();
    onMessage('deleteRecording', ({ data }) => {
      expect(data.id).toBe('abc');
    });
    await expect(sendMessage('deleteRecording', { id: 'abc' })).resolves.toBeUndefined();
    removeAllListeners();
  });
});
