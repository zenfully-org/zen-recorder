import { describe, expect, it, vi } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { type BadgeApi, updateBadge } from './update-badge';

function snapshot(state: TabSnapshot['state'], fault: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state,
    provider: 'meet',
    meetingCode: null,
    title: '',
    recordingId: null,
    recordingStartedAt: null,
    remoteTracks: 0,
    micLabel: null,
    connected: false,
    admitted: false,
    ...fault,
  };
}

function api(
  options: { textColorFails?: boolean } = {},
): BadgeApi & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => async (details: unknown) => {
    const list = calls[name] ?? [];
    calls[name] = list;
    list.push(details);
    if (name === 'setBadgeTextColor' && options.textColorFails) throw new Error('unsupported');
  };
  return {
    calls,
    setBadgeText: record('setBadgeText'),
    setBadgeBackgroundColor: record('setBadgeBackgroundColor'),
    setBadgeTextColor: record('setBadgeTextColor'),
    setTitle: record('setTitle'),
  };
}

describe('updateBadge', () => {
  it.each([
    ['nothing', [], '', '#f4a261', 'Zen Recorder'],
    ['idle tabs', [snapshot('idle'), snapshot('waiting')], '', '#f4a261', 'Zen Recorder'],
    ['a paused tab', [snapshot('paused')], 'II', '#f4a261', 'Zen Recorder: paused'],
    [
      'a recording tab',
      [snapshot('recording'), snapshot('paused')],
      '●',
      '#d7263d',
      'Zen Recorder: recording',
    ],
  ])('with %s', async (_label, snapshots, text, color, title) => {
    const action = api();
    await updateBadge(snapshots, action, () => undefined);
    expect(action.calls['setBadgeText']).toEqual([{ text }]);
    expect(action.calls['setBadgeBackgroundColor']).toEqual([{ color }]);
    expect(action.calls['setTitle']).toEqual([{ title }]);
    expect(action.calls['setBadgeTextColor']).toEqual([{ color: '#ffffff' }]);
  });

  // A stop that waits for space is `stopping`, and a recording that lost its video is
  // `recording`: by their state alone the badge went blank, or showed the recording dot as if all
  // were well.
  it.each([
    [
      'records audio only because its backlog is full',
      snapshot('recording', { backlogFull: 'audio-only' }),
      /^Zen Recorder: audio only\. The video stopped/,
    ],
    [
      'records nothing until its backlog is taken',
      snapshot('stopping', { backlogFull: 'waiting' }),
      /^Zen Recorder: waiting for space\. Nothing records/,
    ],
    [
      'records nothing because the recorder gave up on its encoder',
      snapshot('waiting', { encoderGaveUp: true }),
      /^Zen Recorder: recording failed\. Nothing records.* Press Record there to try again\.$/,
    ],
  ])('shows ! on amber, in dark text, when a tab %s', async (_label, faulty, title) => {
    const action = api();
    await updateBadge([faulty], action, () => undefined);
    expect({
      text: action.calls['setBadgeText'],
      color: action.calls['setBadgeBackgroundColor'],
      textColor: action.calls['setBadgeTextColor'],
      title: action.calls['setTitle'],
    }).toEqual({
      text: [{ text: '!' }],
      color: [{ color: '#fe9a00' }],
      textColor: [{ color: 'black' }],
      title: [{ title: expect.stringMatching(title) }],
    });
  });

  it('shows the fault of one tab over another tab that records as it should', async () => {
    const action = api();
    const faulty = snapshot('stopping', { backlogFull: 'waiting' });
    await updateBadge([snapshot('recording'), faulty], action, () => undefined);
    expect(action.calls['setBadgeText']).toEqual([{ text: '!' }]);
    expect(action.calls['setTitle']).toEqual([
      { title: expect.stringMatching(/^Zen Recorder: waiting for space\./) },
    ]);
  });

  it('tolerates browsers without setBadgeTextColor', async () => {
    const action = api({ textColorFails: true });
    await expect(
      updateBadge([snapshot('recording')], action, () => undefined),
    ).resolves.toBeUndefined();
    expect(vi.isMockFunction(action.setBadgeText)).toBe(false);
  });

  it('says in Diagnostics when the browser refuses the badge, and resolves', async () => {
    const refused = new Error('the window is gone');
    const action: BadgeApi = {
      ...api(),
      setBadgeText: async () => {
        throw refused;
      },
    };
    const warnings: unknown[][] = [];
    const update = updateBadge([snapshot('recording')], action, (...args) => warnings.push(args));
    await expect(update).resolves.toBeUndefined();
    expect(warnings).toEqual([['could not update the toolbar badge:', refused]]);
  });
});
