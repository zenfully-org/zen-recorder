import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTeamsPage } from '@/test/fakes/create-fake-teams-page';
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';
import { findTeamsTiles } from './find-teams-tiles';

describe('findTeamsTiles', () => {
  const page = createFakeTeamsPage(document);
  beforeEach(() => document.body.replaceChildren());

  it('returns nothing on a page without tiles or videos', () => {
    page.showCall();
    expect(findTeamsTiles(document)).toEqual([]);
  });

  it('reads a camera tile: the video, its rect and frame, the name and the element id', () => {
    const call = page.showCall({
      tiles: [
        {
          name: 'Ana Silva',
          elementId: 'e-1',
          rect: { x: 10, y: 20, width: 300, height: 200 },
          video: { videoWidth: 1280, videoHeight: 720, currentTime: 2.5 },
        },
        { name: 'Zen Recorder guest', self: true, elementId: 'e-2' },
      ],
    });
    const [remote, self, ...rest] = findTeamsTiles(document);
    expect(rest).toEqual([]);
    expect(remote).toMatchObject({
      id: 'e-1',
      name: 'Ana Silva',
      isSelf: false,
      isShare: false,
      rect: { x: 10, y: 20, width: 300, height: 200 },
      sourceWidth: 1280,
      sourceHeight: 720,
      frameKey: 2.5,
    });
    expect(remote?.source).toBe(call.querySelector('video'));
    expect(self).toMatchObject({ id: 'e-2', name: 'Zen Recorder guest', isSelf: true });
  });

  it('keeps a participant whose camera is off as a placeholder with the tile rect', () => {
    page.showCall({
      tiles: [
        { name: 'Bruno Costa', camera: false, rect: { x: 5, y: 6, width: 200, height: 100 } },
        { name: 'Me', self: true },
      ],
    });
    expect(findTeamsTiles(document)[0]).toMatchObject({
      name: 'Bruno Costa',
      source: null,
      rect: { x: 5, y: 6, width: 200, height: 100 },
      sourceWidth: 0,
      sourceHeight: 0,
      isSelf: false,
    });
  });

  it('flags the screen share, and only one of them', () => {
    page.showCall({
      tiles: [
        { name: 'Ana Silva', stream: 'ScreenSharing' },
        { name: 'Bruno Costa', stream: 'ScreenSharing' },
        { name: 'Ana Silva' },
        { name: 'Me', self: true },
      ],
    });
    expect(findTeamsTiles(document).map((tile) => [tile.name, tile.isShare, tile.isSelf])).toEqual([
      ['Ana Silva', true, false],
      ['Bruno Costa', false, false],
      ['Ana Silva', false, false],
      ['Me', false, true],
    ]);
  });

  it('draws a share the way the page shows it: whole, inside its box (object-fit: contain)', () => {
    const call = page.showCall({
      tiles: [
        {
          name: 'Ana Silva',
          stream: 'ScreenSharing',
          rect: { x: 0, y: 0, width: 1000, height: 1000 },
          video: { videoWidth: 1920, videoHeight: 1080 },
        },
        { name: 'Ana Silva', rect: { x: 1000, y: 0, width: 200, height: 200 } },
      ],
    });
    call.querySelector('video')?.setAttribute('style', 'width: 100%; object-fit: contain;');
    const [share, camera] = findTeamsTiles(document);
    expect(share?.rect).toEqual({ x: 0, y: 218.75, width: 1000, height: 562.5 });
    expect(camera?.rect).toEqual({ x: 1000, y: 0, width: 200, height: 200 });
  });

  it('takes the only camera tile without a voice outline for the user’s own', () => {
    page.showCall({ tiles: [{ name: 'A' }, { name: 'B', self: true, camera: false }] });
    expect(findTeamsTiles(document).map((tile) => tile.isSelf)).toEqual([false, true]);
  });

  it('names no tile the user’s own when several have no voice outline', () => {
    page.showCall({
      tiles: [{ name: 'A', self: true }, { name: 'Bot', self: true }, { name: 'C' }],
    });
    expect(findTeamsTiles(document).map((tile) => tile.isSelf)).toEqual([false, false, false]);
  });

  it('gives tiles without an element id one made of the stream type and position', () => {
    page
      .showCall()
      .append(
        page.createTile({ name: 'A', elementId: null }),
        page.createTile({ name: 'B', elementId: null, stream: 'ScreenSharing' }),
      );
    expect(findTeamsTiles(document).map((tile) => tile.id)).toEqual(['Video-0', 'ScreenSharing-1']);
  });

  it('keeps ids unique when tiles share an element id', () => {
    page.showCall({
      tiles: [
        { name: 'A', elementId: 'same' },
        { name: 'B', elementId: 'same' },
        { name: 'C', elementId: 'same' },
      ],
    });
    expect(findTeamsTiles(document).map((tile) => tile.id)).toEqual(['same', 'same#1', 'same#2']);
  });

  it('reports no name for a tile that has none', () => {
    const call = page.showCall({ tiles: [{ name: '  ' }, { name: 'x' }] });
    call.querySelectorAll('[data-stream-type]')[1]?.removeAttribute('data-tid');
    expect(findTeamsTiles(document).map((tile) => tile.name)).toEqual([null, null]);
  });

  it('falls back to the playing videos, the pre-join preview being the user’s own', () => {
    page.showPrejoin();
    const other = createFakeVideoTile(document, { participantId: null, tileMediaId: null });
    const paused = createFakeVideoTile(document, {
      participantId: null,
      tileMediaId: null,
      paused: true,
    });
    document.body.append(other.container, paused.container);
    expect(findTeamsTiles(document).map((tile) => [tile.id, tile.isSelf, tile.isShare])).toEqual([
      ['video-0', true, false],
      ['video-1', false, false],
    ]);
  });

  it('prefers the stage tiles over other videos on the page', () => {
    page.showPrejoin();
    page.showCall({ tiles: [{ name: 'A', elementId: 'a' }] });
    expect(findTeamsTiles(document).map((tile) => tile.id)).toEqual(['a']);
  });

  it('re-resolves on every call instead of caching', () => {
    const call = page.showCall({ tiles: [{ name: 'Old', elementId: 'a' }] });
    expect(findTeamsTiles(document)[0]?.name).toBe('Old');
    call.querySelector('[data-stream-type]')?.setAttribute('data-tid', 'New');
    expect(findTeamsTiles(document)[0]?.name).toBe('New');
  });
});
