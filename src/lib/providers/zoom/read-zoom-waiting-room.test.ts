import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeZoomPage } from '@/test/fakes/create-fake-zoom-page';
import { readZoomWaitingRoom } from './read-zoom-waiting-room';

const BUTTON = '#participant button';

describe('readZoomWaitingRoom', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('sees nobody waiting on an empty page', () => {
    expect(readZoomWaitingRoom(document)).toBe(0);
  });

  it.each([
    ['nobody waiting', 0, 0],
    ['one guest knocking', 1, 1],
    ['three guests knocking', 3, 3],
  ])('as the host, %s: reads %j from the Participants button', (_label, waiting, expected) => {
    createFakeZoomPage(document).showMeeting({ host: true, participants: 1, waiting });
    expect(readZoomWaitingRoom(document)).toBe(expected);
  });

  it('reads the waiting room from the open panel once the button no longer names it', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ host: true, participants: 2, waiting: 2 });
    page.showParticipantsPanel();
    expect(document.querySelector(BUTTON)?.getAttribute('aria-label')).toBe(
      'close the manage participants list pane',
    );
    expect(readZoomWaitingRoom(document)).toBe(2);
    page.setWaiting(0);
    expect(readZoomWaitingRoom(document)).toBe(0);
  });

  it('sees no waiting room as a participant: only hosts and co-hosts are shown it', () => {
    createFakeZoomPage(document).showMeeting({ participants: 2, waiting: 1 });
    expect(document.querySelector(BUTTON)?.getAttribute('aria-label')).toBe(
      'open the participants list pane,[2] particpants',
    );
    expect(readZoomWaitingRoom(document)).toBe(0);
  });

  it.each([
    // A label the client changed or translated: nothing is subtracted, as before the fix.
    ['a translated label', 'Teilnehmerliste öffnen,2 Teilnehmer,1 Personen im Warteraum'],
    ['no label', null],
  ])('reads nobody waiting from %s', (_label, ariaLabel) => {
    createFakeZoomPage(document).showMeeting({ host: true, participants: 1, waiting: 1 });
    const button = document.querySelector(BUTTON);
    if (ariaLabel === null) button?.removeAttribute('aria-label');
    else button?.setAttribute('aria-label', ariaLabel);
    expect(readZoomWaitingRoom(document)).toBe(0);
  });

  it('ignores a panel section title without a count', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ host: true, participants: 1, waiting: 1 });
    page.showParticipantsPanel();
    for (const trigger of document.querySelectorAll('.collapsible-section-title__trigger')) {
      trigger.textContent = 'Waiting Room';
    }
    expect(readZoomWaitingRoom(document)).toBe(0);
  });

  it('reads the button of the counter, not the panel settings toggle next to it', () => {
    createFakeZoomPage(document).showMeeting({ host: true, participants: 1, waiting: 1 });
    const toggle = document.createElement('button');
    toggle.setAttribute('aria-label', 'Participants Settings');
    document.querySelector('#participant')?.prepend(toggle);
    expect(readZoomWaitingRoom(document)).toBe(1);
  });
});
