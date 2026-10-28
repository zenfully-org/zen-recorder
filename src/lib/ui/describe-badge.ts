/**
 * What the toolbar button shows for every meeting tab at once. A fault that lasts in any tab
 * (`describeTabAlert`) shows as ! on amber with that fault's words as the title, the most pressing
 * one when several tabs have one: it wins over a tab that records as it should, so it stays in
 * sight whichever tab is in front. Otherwise a record dot on red while a tab records, II while one
 * is paused, nothing otherwise: the status card's own dot and bars. The text is the shape that
 * tells them apart, the colour only a second cue. Firefox draws an extension's badge at most 20 px
 * wide, 16 px of it text in a 10 px font (9 px on macOS, bold on Windows), and cuts what does not
 * fit without an ellipsis: "REC" showed as "RE" and part of a C. One or two narrow characters fit.
 */
import type { TabSnapshot } from '@/lib/types';
import { describeTabAlert, type TabAlert } from '@/lib/ui/describe-tab-alert';

/** What the badge reads of a tab's snapshot. */
export type BadgeTab = Pick<
  TabSnapshot,
  'state' | 'backlogFull' | 'encoderGaveUp' | 'unknownAddress'
>;

export interface Badge {
  text: string;
  color: string;
  textColor: string;
  title: string;
}

const IDLE: Badge = { text: '', color: '#f4a261', textColor: '#ffffff', title: 'Zen Recorder' };
const PAUSED: Badge = { ...IDLE, text: 'II', title: 'Zen Recorder: paused' };
const RECORDING: Badge = {
  // U+25CF BLACK CIRCLE, a text character with no emoji form: it is drawn in the badge's white.
  text: '●',
  color: '#d7263d',
  textColor: '#ffffff',
  title: 'Zen Recorder: recording',
};
/** The status card's amber; black reads on it where white does not (Firefox picks black too). */
const FAULT = { text: '!', color: '#fe9a00', textColor: 'black' };

export function describeBadge(tabs: Iterable<BadgeTab>): Badge {
  let worst: TabAlert | null = null;
  let recording = false;
  let paused = false;
  for (const tab of tabs) {
    const alert = describeTabAlert(tab);
    if (alert && alert.severity > (worst?.severity ?? 0)) worst = alert;
    recording ||= tab.state === 'recording';
    paused ||= tab.state === 'paused';
  }
  if (worst) return { ...FAULT, title: worst.toolbar };
  if (recording) return RECORDING;
  return paused ? PAUSED : IDLE;
}
