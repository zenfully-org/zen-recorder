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

describe('describeBadge', () => {
  it.each([
    ['no meeting tab', [], ''],
    ['tabs that record nothing, as they should', [tab('idle'), tab('waiting')], ''],
    ['a paused tab', [tab('paused')], 'II'],
    ['a recording tab beside a paused one', [tab('paused'), tab('recording')], 'REC'],
  ])('says what the tabs do with %s', (_label, tabs, text) => {
    expect(describeBadge(tabs).text).toBe(text);
  });

  it('shows REC on red, II and nothing on orange, in white', () => {
    expect(describeBadge([tab('recording')])).toEqual({
      text: 'REC',
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

  // A stop that waits for space is `stopping` and a recorder that gave up is `waiting`: by their
  // state the badge was blank. A recording that lost its video is `recording`: it said REC.
  it.each([
    ['records audio only', tab('recording', AUDIO_ONLY), AUDIO_ONLY],
    ['is paused while its video waits', tab('paused', AUDIO_ONLY), AUDIO_ONLY],
    ['waits for space', tab('stopping', WAITING), WAITING],
    ['gave up on its encoder', tab('waiting', GAVE_UP), GAVE_UP],
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
  ])('says the most pressing fault of several tabs: %s', (_label, faults, worst) => {
    const tabs = faults.map((fault) => tab('recording', fault));
    expect(describeBadge(tabs).title).toBe(describeTabAlert(worst)?.toolbar);
  });
});
