import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { StartRule } from '@/lib/types';
import { describeStartRule } from './describe-start-rule';

describe('describeStartRule', () => {
  it.each<[StartRule, string]>([
    // Someone who joins muted sends no audio, and the recording still starts.
    ['firstRemote', 'once someone else is in the call'],
    ['onJoin', 'as soon as the call is connected (even alone)'],
  ])('names the %s rule by what it waits for', (rule, words) => {
    expect(describeStartRule(rule)).toBe(words);
  });

  it("is what the user guide's settings table names as the default start rule", () => {
    const guide = readFileSync(
      path.resolve(import.meta.dirname, '../../../docs/user-guide.md'),
      'utf8',
    );
    const row = guide
      .split('\n')
      .find((line) => line.startsWith('| Recording → Start recording |'));
    expect(row?.split(' | ')[1]).toBe(describeStartRule(getDefaultSettings().startRule));
  });
});
