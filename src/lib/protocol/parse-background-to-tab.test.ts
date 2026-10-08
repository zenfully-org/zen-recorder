import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { parseBackgroundToTab } from './parse-background-to-tab';

describe('parseBackgroundToTab', () => {
  it.each([
    ['ack', { type: 'ack', recordingId: 'r', seq: 4 }],
    ['endAck', { type: 'endAck', recordingId: 'r' }],
    ['command', { type: 'command', command: 'pause' }],
    ['saved', { type: 'saved', recordingId: 'r', filename: 'f.webm', chunkCount: 2, byteSize: 10 }],
    ['error', { type: 'error', recordingId: null, message: 'boom' }],
  ])('accepts %s', (_label, message) => {
    expect(parseBackgroundToTab(message)).toEqual(message);
  });

  it('normalizes settings through parseSettings', () => {
    expect(parseBackgroundToTab({ type: 'settings', settings: { autoRecord: false } })).toEqual({
      type: 'settings',
      settings: { ...getDefaultSettings(), autoRecord: false },
    });
  });

  it.each([
    ['an unknown type', { type: 'nope' }],
    ['an ack without seq', { type: 'ack', recordingId: 'r' }],
    ['an endAck without recordingId', { type: 'endAck' }],
    ['an unknown command', { type: 'command', command: 'dance' }],
    ['a saved without filename', { type: 'saved', recordingId: 'r' }],
    ['an error without message', { type: 'error', recordingId: null }],
    ['a non-object', 42],
  ])('rejects %s', (_label, message) => {
    expect(parseBackgroundToTab(message)).toBeNull();
  });
});
