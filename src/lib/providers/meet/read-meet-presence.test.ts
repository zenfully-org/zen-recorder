import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeVideoTile,
  type FakeVideoTileOptions,
} from '@/test/fakes/create-fake-video-tile';
import { readMeetPresence } from './read-meet-presence';

const SELF = { participantId: 'spaces/x/devices/1', tileMediaId: 'm1', name: 'You', self: true };
const ANA = { participantId: 'spaces/x/devices/2', tileMediaId: 'm2', name: 'Ana Souza' };

function show(...tiles: FakeVideoTileOptions[]): void {
  document.body.append(...tiles.map((tile) => createFakeVideoTile(document, tile).container));
}

const people = () => readMeetPresence(document, null).participants;

describe('readMeetPresence', () => {
  beforeEach(() => document.body.replaceChildren());

  it('reads every tile by its participant id, the user by the self view controls', () => {
    show(SELF, ANA);
    expect(readMeetPresence(document, 2)).toEqual({
      participants: [
        { key: 'spaces/x/devices/1', name: 'You', self: true },
        { key: 'spaces/x/devices/2', name: 'Ana Souza', self: false },
      ],
      source: 'stage',
      count: 2,
      // No marker on Meet's page has been verified to label a presentation.
      share: { kind: 'unknown' },
      // The microphone track's own state tells: muting on Meet disables it.
      selfMic: null,
    });
  });

  it('finds nobody on a page without tiles', () => {
    expect(readMeetPresence(document, null)).toMatchObject({ participants: [], count: null });
  });

  it('finds the user alone', () => {
    show(SELF);
    expect(people()).toEqual([{ key: 'spaces/x/devices/1', name: 'You', self: true }]);
  });

  it('counts a person whose camera is off: their tile has no video', () => {
    show(SELF, { ...ANA, withoutVideo: true });
    expect(people().map(({ key }) => key)).toEqual(['spaces/x/devices/1', 'spaces/x/devices/2']);
  });

  it('keys a person by their participant id, not by the media slot that shows them', () => {
    show(SELF, ANA);
    const before = people();
    document.body.replaceChildren();
    show({ ...ANA, tileMediaId: 'm7', withoutVideo: true }, { ...SELF, tileMediaId: 'm3' });
    expect(people().map(({ key }) => key)).toEqual(before.map(({ key }) => key).reverse());
  });

  it('takes two tiles of one participant (a camera and a presentation) for one person', () => {
    show(SELF, ANA, { ...ANA, tileMediaId: 'm9', name: null }, { ...SELF, tileMediaId: 'm8' });
    expect(people()).toEqual([
      { key: 'spaces/x/devices/1', name: 'You', self: true },
      { key: 'spaces/x/devices/2', name: 'Ana Souza', self: false },
    ]);
    expect(readMeetPresence(document, 2).share).toEqual({ kind: 'unknown' });
  });

  it('takes the name from whichever tile of the person shows one', () => {
    show({ ...ANA, name: null }, { ...ANA, tileMediaId: 'm9', name: '  Ana Souza ' });
    expect(people()).toEqual([{ key: 'spaces/x/devices/2', name: 'Ana Souza', self: null }]);
  });

  it('leaves out a tile with an empty participant id, and reads a tile that shows nothing', () => {
    show(
      SELF,
      { participantId: '', name: 'Nobody' },
      { participantId: 'spaces/x/devices/4', name: null, withoutVideo: true },
    );
    expect(people()).toEqual([
      { key: 'spaces/x/devices/1', name: 'You', self: true },
      { key: 'spaces/x/devices/4', name: null, self: false },
    ]);
  });

  it('cannot tell who the user is without a self view on the page', () => {
    show(ANA, { participantId: 'spaces/x/devices/3', name: null });
    expect(people()).toEqual([
      { key: 'spaces/x/devices/2', name: 'Ana Souza', self: null },
      { key: 'spaces/x/devices/3', name: null, self: null },
    ]);
  });
});
