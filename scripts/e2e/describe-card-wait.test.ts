import { describe, expect, it } from 'vitest';
import { type CardWait, describeCardWait } from './describe-card-wait';

const started: CardWait = {
  bridgesStarted: ['k3x9qa'],
  recorder: { configuredBy: null },
  mounted: false,
};
const mounted: CardWait = { ...started, recorder: { configuredBy: 'k3x9qa' }, mounted: true };

describe('describeCardWait', () => {
  it.each<[string, CardWait, string]>([
    [
      'no bridge started',
      { bridgesStarted: [], recorder: null, mounted: false },
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

  it.each<[string, CardWait, string]>([
    [
      'no snapshot of the page reached the bridge',
      mounted,
      "bridge k3x9qa mounted the card, but the card has had no update: no snapshot from the page's recorder has reached the bridge",
    ],
    [
      "the bridge has not configured the page's recorder",
      { ...mounted, recorder: { configuredBy: null } },
      "bridge k3x9qa mounted the card, but the card has had no update: the bridge has not configured the page's recorder, which sends its first snapshot once configured",
    ],
    [
      'the page has no recorder to tell the card anything',
      { ...mounted, recorder: null },
      "bridge k3x9qa mounted the card, but the card has had no update: the page's recorder is not running, so nothing tells the card what the tab is doing",
    ],
  ])('says the card waits for its first update when %s', (_, wait, expected) => {
    expect(describeCardWait(wait)).toBe(expected);
  });

  it('speaks of the newest bridge when the page started several', () => {
    const wait: CardWait = {
      bridgesStarted: ['old111', 'new222'],
      recorder: { configuredBy: null },
      mounted: false,
    };
    expect(describeCardWait(wait)).toMatch(/^bridge new222 started but has not configured/);
  });
});
