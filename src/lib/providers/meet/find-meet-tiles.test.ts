import { describe, expect, it } from 'vitest';
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';
import { findMeetTiles } from './find-meet-tiles';

function root(): HTMLElement {
  const el = document.createElement('div');
  document.body.replaceChildren(el);
  return el;
}

describe('findMeetTiles', () => {
  it('returns nothing on an empty page', () => {
    expect(findMeetTiles(root())).toEqual([]);
  });

  it('prefers tiles that carry both participant and tile-media ids', () => {
    const r = root();
    const tile = createFakeVideoTile(document, {
      participantId: 'spaces/s/devices/7',
      tileMediaId: 'm9',
      name: 'Ana Silva',
      rect: { x: 10, y: 20, width: 300, height: 200 },
      currentTime: 2.5,
    });
    const panelRow = createFakeVideoTile(document, { tileMediaId: null, withoutVideo: true });
    r.append(tile.container, panelRow.container);
    const [found, ...rest] = findMeetTiles(r);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      id: 'spaces/s/devices/7/m9',
      name: 'Ana Silva',
      isSelf: false,
      isShare: false,
      rect: { x: 10, y: 20, width: 300, height: 200 },
      sourceWidth: 640,
      sourceHeight: 360,
      frameKey: 2.5,
    });
    expect(found?.source).toBe(tile.video);
  });

  it('falls back to participant-only containers, ignoring ones without a video', () => {
    const r = root();
    const a = createFakeVideoTile(document, { participantId: 'p-a', tileMediaId: null });
    const b = createFakeVideoTile(document, {
      participantId: 'p-b',
      tileMediaId: null,
      withoutVideo: true,
    });
    r.append(a.container, b.container);
    expect(findMeetTiles(r).map((t) => t.id)).toEqual(['p-a#0']);
  });

  it('falls back to playing <video> elements with frames when Meet exposes no attributes', () => {
    const r = root();
    const playing = createFakeVideoTile(document, {
      participantId: null,
      tileMediaId: null,
      name: 'Bea',
    });
    const paused = createFakeVideoTile(document, {
      participantId: null,
      tileMediaId: null,
      paused: true,
    });
    const empty = createFakeVideoTile(document, {
      participantId: null,
      tileMediaId: null,
      videoWidth: 0,
    });
    const loading = createFakeVideoTile(document, {
      participantId: null,
      tileMediaId: null,
      readyState: 1,
    });
    r.append(playing.container, paused.container, empty.container, loading.container);
    const tiles = findMeetTiles(r);
    expect(tiles.map((t) => [t.id, t.name])).toEqual([['video-0', 'Bea']]);
  });

  it('detects the self-view tile through its Material ligature and keeps camera-off tiles', () => {
    const r = root();
    const self = createFakeVideoTile(document, {
      participantId: 'me',
      self: true,
      videoWidth: 0,
      videoHeight: 0,
    });
    r.append(self.container);
    expect(findMeetTiles(r)).toMatchObject([{ id: 'me/m1', isSelf: true, sourceWidth: 0 }]);
  });

  it('marks a dominant non-self tile as the screen share', () => {
    const r = root();
    const share = createFakeVideoTile(document, {
      participantId: 'p1',
      tileMediaId: 'big',
      rect: { x: 0, y: 0, width: 1200, height: 700 },
    });
    const cam = createFakeVideoTile(document, {
      participantId: 'p2',
      tileMediaId: 'small',
      rect: { x: 1200, y: 0, width: 300, height: 170 },
    });
    const me = createFakeVideoTile(document, {
      participantId: 'me',
      tileMediaId: 'self',
      self: true,
      rect: { x: 1200, y: 200, width: 300, height: 170 },
    });
    r.append(share.container, cam.container, me.container);
    expect(findMeetTiles(r).map((t) => [t.id, t.isShare])).toEqual([
      ['p1/big', true],
      ['p2/small', false],
      ['me/self', false],
    ]);
  });

  it('does not mark a share when tiles are similar in size', () => {
    const r = root();
    const a = createFakeVideoTile(document, {
      participantId: 'p1',
      rect: { x: 0, y: 0, width: 500, height: 300 },
    });
    const b = createFakeVideoTile(document, {
      participantId: 'p2',
      rect: { x: 500, y: 0, width: 400, height: 300 },
    });
    r.append(a.container, b.container);
    expect(findMeetTiles(r).every((t) => !t.isShare)).toBe(true);
  });

  it('reports no name for a tile without a label', () => {
    const r = root();
    const tile = createFakeVideoTile(document, { participantId: 'p1', name: null });
    r.append(tile.container);
    expect(findMeetTiles(r)).toMatchObject([{ id: 'p1/m1', name: null, isSelf: false }]);
  });

  it('never marks a share when only self tiles have an area', () => {
    const r = root();
    const a = createFakeVideoTile(document, { participantId: 'me', tileMediaId: 'a', self: true });
    const b = createFakeVideoTile(document, { participantId: 'me', tileMediaId: 'b', self: true });
    r.append(a.container, b.container);
    expect(findMeetTiles(r).map((t) => t.isShare)).toEqual([false, false]);
  });

  it('re-resolves on every call instead of caching', () => {
    const r = root();
    const tile = createFakeVideoTile(document, { participantId: 'p1', name: 'Old' });
    r.append(tile.container);
    expect(findMeetTiles(r)[0]?.name).toBe('Old');
    const span = tile.container.querySelector('span');
    if (span) span.textContent = 'New';
    tile.set({ currentTime: 9 });
    expect(findMeetTiles(r)[0]).toMatchObject({ name: 'New', frameKey: 9 });
  });
});
