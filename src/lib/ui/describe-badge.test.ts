import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { type BadgeTab, describeBadge } from './describe-badge';
import { describeTabAlert } from './describe-tab-alert';

const tab = (state: TabSnapshot['state'], fault: Omit<BadgeTab, 'state'> = {}): BadgeTab => ({
  state,
  ...fault,
});

const AUDIO_ONLY = { backlogFull: 'audio-only' } as const;
const WAITING = { backlogFull: 'waiting' } as const;
const GAVE_UP = { encoderGaveUp: true } as const;
const UNKNOWN_ADDRESS = { unknownAddress: true } as const;

describe('describeBadge', () => {
  it.each([
    ['no meeting tab', [], ''],
    ['tabs that record nothing, as they should', [tab('idle'), tab('waiting')], ''],
    ['a paused tab', [tab('paused')], 'II'],
    ['a recording tab beside a paused one', [tab('paused'), tab('recording')], '●'],
  ])('says what the tabs do with %s', (_label, tabs, text) => {
    expect(describeBadge(tabs).text).toBe(text);
  });

  it('shows a record dot on red, II and nothing on orange, in white', () => {
    expect(describeBadge([tab('recording')])).toEqual({
      text: '●',
      color: '#d7263d',
      textColor: '#ffffff',
      title: 'Zen Recorder: recording',
    });
    expect(describeBadge([tab('paused')])).toEqual({
      text: 'II',
      color: '#f4a261',
      textColor: '#ffffff',
      title: 'Zen Recorder: paused',
    });
    expect(describeBadge([])).toEqual({
      text: '',
      color: '#f4a261',
      textColor: '#ffffff',
      title: 'Zen Recorder',
    });
  });

  // Firefox draws a badge at most 20 px wide, 16 px of it text, and cuts what does not fit without
  // an ellipsis: "REC" showed as "RE" and part of a C. The end-to-end run measures the drawn badge.
  it.each([
    ['records', [tab('recording')]],
    ['is paused', [tab('paused')]],
    ['has a fault', [tab('recording', AUDIO_ONLY)]],
  ])('shows at most two characters while a tab %s', (_label, tabs) => {
    expect([...describeBadge(tabs).text].length).toBeLessThanOrEqual(2);
  });

  it('tells recording, paused and a fault apart by the text alone', () => {
    const texts = [tab('recording'), tab('paused'), tab('recording', WAITING)].map(
      (one) => describeBadge([one]).text,
    );
    expect(new Set(texts).size).toBe(3);
  });

  // A stop that waits for space is `stopping` and a recorder that gave up is `waiting`: by their
  // state the badge was blank. A recording that lost its video is `recording`: it showed the dot.
  it.each([
    ['records audio only', tab('recording', AUDIO_ONLY), AUDIO_ONLY],
    ['is paused while its video waits', tab('paused', AUDIO_ONLY), AUDIO_ONLY],
    ['waits for space', tab('stopping', WAITING), WAITING],
    ['gave up on its encoder', tab('waiting', GAVE_UP), GAVE_UP],
    ['is in a call at an address it does not know', tab('idle', UNKNOWN_ADDRESS), UNKNOWN_ADDRESS],
  ])(
    'shows ! on amber in black, with the toolbar words, when a tab %s',
    (_label, faulty, fault) => {
      expect(describeBadge([faulty])).toEqual({
        text: '!',
        color: '#fe9a00',
        textColor: 'black',
        title: describeTabAlert(fault)?.toolbar,
      });
    },
  );

  it('shows a fault over a tab that records as it should, whatever their order', () => {
    const fault = tab('stopping', WAITING);
    for (const tabs of [
      [tab('recording'), fault],
      [fault, tab('recording')],
    ]) {
      expect(describeBadge(tabs)).toMatchObject({
        text: '!',
        title: expect.stringMatching(/space/),
      });
    }
  });

  it.each([
    ['audio only, then nothing records', [AUDIO_ONLY, WAITING], WAITING],
    ['nothing records, then audio only', [WAITING, AUDIO_ONLY], WAITING],
    ['a gave-up encoder beside a full backlog', [WAITING, GAVE_UP, AUDIO_ONLY], GAVE_UP],
    [
      'a call at an unknown address beside the rest',
      [GAVE_UP, UNKNOWN_ADDRESS, WAITING],
      UNKNOWN_ADDRESS,
    ],
  ])('says the most pressing fault of several tabs: %s', (_label, faults, worst) => {
    const tabs = faults.map((fault) => tab('recording', fault));
    expect(describeBadge(tabs).title).toBe(describeTabAlert(worst)?.toolbar);
  });
});
