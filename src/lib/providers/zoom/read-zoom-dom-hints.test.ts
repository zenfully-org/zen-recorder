import { beforeEach, describe, expect, it } from 'vitest';
import type { MicState } from '@/lib/providers/types';
import { createFakeZoomPage, type FakeZoomAudio } from '@/test/fakes/create-fake-zoom-page';
import { readZoomDomHints } from './read-zoom-dom-hints';

const NOTHING = {
  inMeetingUi: false,
  admitted: false,
  participants: null,
  waiting: 0,
  mic: null,
  micMuted: null,
};

describe('readZoomDomHints', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('sees nothing on an empty page', () => {
    expect(readZoomDomHints(document)).toEqual({ ...NOTHING, topic: null });
  });

  it('does not take the preview screen for the meeting', () => {
    createFakeZoomPage(document).showPreview();
    expect(readZoomDomHints(document)).toEqual({ ...NOTHING, topic: null });
  });

  it('reads the topic, the participant count and the microphone state once in the meeting', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ topic: ' Weekly sync ', participants: 3, audio: 'unmuted' });
    expect(readZoomDomHints(document)).toEqual({
      inMeetingUi: true,
      admitted: true,
      participants: 3,
      waiting: 0,
      mic: 'live',
      micMuted: false,
      topic: 'Weekly sync',
    });
  });

  it.each([
    // The host's counter counts the waiting room too: 2 shown, one of them still waiting.
    ['a guest knocking', 1, 1, 1],
    ['two waiting next to two others', 3, 2, 3],
  ])(
    'as the host with %s: counts the people in the meeting only',
    (_l, inMeeting, waiting, participants) => {
      createFakeZoomPage(document).showMeeting({ host: true, participants: inMeeting, waiting });
      expect(readZoomDomHints(document)).toMatchObject({
        inMeetingUi: true,
        admitted: true,
        participants,
        waiting,
      });
    },
  );

  it('never counts fewer than nobody when the waiting room reads larger than the counter', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ host: true, participants: 1, waiting: 1 });
    const counter = document.querySelector('#participant .footer-button__number-counter');
    if (counter) counter.textContent = '1';
    document
      .querySelector('#participant button')
      ?.setAttribute(
        'aria-label',
        'open the manage participants list pane,1 particpants,3 people are in waiting room',
      );
    // Admission still comes from the counter: the user is counted in it.
    expect(readZoomDomHints(document)).toMatchObject({
      admitted: true,
      participants: 0,
      waiting: 3,
    });
  });

  it.each([
    // "Joining Meeting…": the footer is already rendered, the counter is not.
    ['no counter and no tile yet', null, 0, false],
    // The waiting room, a meeting the host has not started, a join that failed: nobody counted.
    ['a counter of zero', 0, 0, false],
    ['a counter of zero, whatever is on the stage', 0, 1, false],
    ['the user counted', 1, 0, true],
    // Layouts without the participants button: a tile on the stage is the proof.
    ['no counter, but a tile on the stage', null, 1, true],
  ])('admission with %s', (_label, participants, tiles, admitted) => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants });
    for (let index = 0; index < tiles; index++) page.addAvatarTile();
    expect(readZoomDomHints(document)).toMatchObject({ inMeetingUi: true, admitted, participants });
  });

  it('counts a camera tile on the stage as well as an avatar', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: null });
    page.addVideoTile();
    expect(readZoomDomHints(document).admitted).toBe(true);
  });

  it('needs the meeting footer: tiles alone are not the meeting', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 2 });
    page.addAvatarTile();
    document.querySelector('#wc-footer')?.remove();
    expect(readZoomDomHints(document)).toMatchObject({ inMeetingUi: false, admitted: false });
  });

  it.each<[FakeZoomAudio, MicState, boolean]>([
    // The button shows what a click would do: "Mute" while the microphone is live.
    ['unmuted', 'live', false],
    ['muted', 'muted', true],
    // Audio not joined: the meeting does not hear the microphone at all.
    ['not-joined', 'not-connected', true],
  ])('microphone %s → %s, muted %j', (audio, mic, muted) => {
    createFakeZoomPage(document).showMeeting({ audio });
    expect(readZoomDomHints(document)).toMatchObject({ mic, micMuted: muted });
  });

  it.each<[string, MicState | null, boolean | null]>([
    ['SvgAudioMuteHovered', 'live', false],
    ['SvgAudioUnmuteHovered', 'muted', true],
    // The microphone cannot be used: muted, as far as the meeting hears it.
    ['SvgAudioUnmuteDisallowed', 'muted', true],
    ['SvgAudioJoinHovered', 'not-connected', true],
    ['lazy-svg-icon__icon SvgAudioUnmute', 'muted', true],
    // An icon it does not know (phone audio, a redesign): cannot tell.
    ['SvgAudioPhone', null, null],
    ['', null, null],
  ])('audio icon "%s" → %s, muted %j', (className, mic, muted) => {
    createFakeZoomPage(document).showMeeting();
    document
      .querySelector('button.join-audio-container__btn svg')
      ?.setAttribute('class', className);
    expect(readZoomDomHints(document)).toMatchObject({ mic, micMuted: muted });
  });

  it('cannot tell the microphone state without the audio button', () => {
    createFakeZoomPage(document).showMeeting();
    document.querySelector('button.join-audio-container__btn')?.replaceChildren();
    expect(readZoomDomHints(document)).toMatchObject({ mic: null, micMuted: null });
  });

  it('ignores a counter that is not a number and an empty topic', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 2, topic: '   ' });
    const counter = document.querySelector('#participant .footer-button__number-counter');
    if (counter) counter.textContent = '…';
    expect(readZoomDomHints(document)).toMatchObject({ participants: null, topic: null });
  });

  it('reads the leading number of an abbreviated counter', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: 2 });
    const counter = document.querySelector('#participant .footer-button__number-counter');
    if (counter) counter.textContent = ' 12+ ';
    expect(readZoomDomHints(document).participants).toBe(12);
  });
});
