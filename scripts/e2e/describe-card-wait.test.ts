import { describe, expect, it } from 'vitest';
import { type CardWait, describeCardWait } from './describe-card-wait';

const started: CardWait = { bridgesStarted: ['k3x9qa'], recorder: { configuredBy: null } };

describe('describeCardWait', () => {
  it.each<[string, CardWait, string]>([
    [
      'no bridge started',
      { bridgesStarted: [], recorder: null },
      "no bridge started in the page: the extension's content scripts did not run there",
    ],
    [
      'the bridge started but configured nothing',
      started,
      "bridge k3x9qa started but has not configured the page's recorder: its read of the settings from the extension's storage has not returned",
    ],
    [
      'the bridge configured the page',
      { ...started, recorder: { configuredBy: 'k3x9qa' } },
      "bridge k3x9qa configured the page's recorder but has not mounted the card: it waits for the page's body or for where the card was left (the extension's storage)",
    ],
    [
      'the page has no recorder to ask',
      { ...started, recorder: null },
      "bridge k3x9qa started, and the page's recorder is not running, so whether the bridge read its settings is unknown",
    ],
    [
      "the page's recorder cannot say which bridge configured it",
      { ...started, recorder: { configuredBy: undefined } },
      "bridge k3x9qa started, and the page's recorder is too old to say whether a bridge configured it",
    ],
  ])('names the step when %s', (_, wait, expected) => {
    expect(describeCardWait(wait)).toBe(expected);
  });

  it('speaks of the newest bridge when the page started several', () => {
    const wait: CardWait = {
      bridgesStarted: ['old111', 'new222'],
      recorder: { configuredBy: null },
    };
    expect(describeCardWait(wait)).toMatch(/^bridge new222 started but has not configured/);
  });
});
