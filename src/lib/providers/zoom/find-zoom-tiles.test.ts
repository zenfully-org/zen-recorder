import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeZoomPage } from '@/test/fakes/create-fake-zoom-page';
import { findZoomTiles } from './find-zoom-tiles';

const STAGE = { x: 0, y: 0, width: 1280, height: 720 };
const LEFT = { x: 0, y: 180, width: 640, height: 360 };
const RIGHT = { x: 640, y: 180, width: 640, height: 360 };

describe('findZoomTiles', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('returns nothing on an empty page and in a meeting without tiles', () => {
    expect(findZoomTiles(document, 1)).toEqual([]);
    createFakeZoomPage(document).showMeeting();
    expect(findZoomTiles(document, 1)).toEqual([]);
  });

  it('reads a camera tile as its own region of the shared stage canvas', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ nodeId: '16778240', name: ' Ana Silva ', rect: RIGHT });
    expect(findZoomTiles(document, 7)).toEqual([
      {
        id: '16778240',
        source: page.stageCanvas(),
        rect: RIGHT,
        name: 'Ana Silva',
        isSelf: false,
        isShare: false,
        sourceWidth: 1280,
        sourceHeight: 720,
        crop: RIGHT,
        frameKey: 7,
      },
    ]);
  });

  it('measures the region in canvas pixels, wherever the canvas sits on the page', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: { x: 100, y: 50, width: 1000, height: 500 }, scale: 2 });
    page.addVideoTile({ rect: { x: 350, y: 100, width: 500, height: 250 } });
    expect(findZoomTiles(document, 1)[0]).toMatchObject({
      rect: { x: 350, y: 100, width: 500, height: 250 },
      sourceWidth: 2000,
      sourceHeight: 1000,
      crop: { x: 500, y: 100, width: 1000, height: 500 },
    });
  });

  it('keeps a tile that hangs over the edge of the canvas to the part that is painted', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ rect: { x: 1000, y: -100, width: 640, height: 360 } });
    expect(findZoomTiles(document, 1)[0]?.crop).toEqual({ x: 1000, y: 0, width: 280, height: 260 });
  });

  it('skips a tile whose region is not on the canvas at all', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ rect: { x: 2000, y: 0, width: 640, height: 360 } });
    expect(findZoomTiles(document, 1)).toEqual([]);
  });

  it('draws a participant with the camera off as a placeholder with the name', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    const avatar = page.addAvatarTile({ name: 'Zen Recorder', rect: LEFT });
    expect(findZoomTiles(document, 3)).toEqual([
      {
        id: 'avatar-0',
        source: null,
        rect: LEFT,
        name: 'Zen Recorder',
        isSelf: false,
        isShare: false,
        sourceWidth: 0,
        sourceHeight: 0,
        frameKey: 0,
      },
    ]);
    expect(document.contains(avatar)).toBe(true);
  });

  it('finds every participant of a gallery, camera on or off, once each', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ nodeId: '16778240', name: 'Ana', rect: LEFT });
    page.addAvatarTile({ name: 'Bea', rect: RIGHT });
    const tiles = findZoomTiles(document, 1);
    // The name overlay of a camera tile is an avatar element too: it must not become a second tile.
    expect(tiles.map((tile) => [tile.id, tile.name, tile.source !== null])).toEqual([
      ['16778240', 'Ana', true],
      ['avatar-0', 'Bea', false],
    ]);
  });

  it('gives tiles without a name a null name', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ name: null, rect: LEFT });
    page.addAvatarTile({ name: null, rect: RIGHT });
    expect(findZoomTiles(document, 1).map((tile) => tile.name)).toEqual([null, null]);
  });

  it('keeps ids unique when the same participant shows twice', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ nodeId: '16778240', rect: LEFT });
    page.addVideoTile({ nodeId: '16778240', rect: RIGHT });
    page.addVideoTile({ nodeId: '16778240', rect: STAGE });
    expect(findZoomTiles(document, 1).map((tile) => tile.id)).toEqual([
      '16778240',
      '16778240#1',
      '16778240#2',
    ]);
  });

  it('skips what is not on screen: hidden players, hidden avatars, a hidden canvas', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    const hidden = { x: 0, y: 0, width: 0, height: 0 };
    page.addVideoTile({ rect: hidden });
    page.addAvatarTile({ rect: hidden });
    expect(findZoomTiles(document, 1)).toEqual([]);
    page.addVideoTile({ rect: LEFT });
    const canvas = page.stageCanvas();
    if (canvas) page.place(canvas, hidden);
    expect(findZoomTiles(document, 1)).toEqual([]);
  });

  it('flags the tile of the share container as the screen share', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    page.addVideoTile({ nodeId: '16778240', rect: { x: 1000, y: 0, width: 280, height: 158 } });
    const share = page.startShare({ x: 0, y: 0, width: 960, height: 540 });
    const tiles = findZoomTiles(document, 1);
    expect(tiles.map((tile) => [tile.id, tile.isShare])).toEqual([
      ['16778240', false],
      ['share-content', true],
    ]);
    expect(tiles[1]?.source).toBe(share.parentElement?.shadowRoot?.querySelector('canvas'));
    expect(tiles[1]?.rect).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('finds nothing in a share container that is not showing a share', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    const share = page.startShare({ x: 0, y: 0, width: 960, height: 540 });
    share.parentElement?.shadowRoot?.querySelector('canvas')?.remove();
    expect(findZoomTiles(document, 1)).toEqual([]);
  });

  it('reads a player that paints its own canvas (the camera preview) whole', () => {
    const page = createFakeZoomPage(document);
    const rect = { x: 74, y: 186, width: 700, height: 394 };
    page.showPreview(rect);
    const canvas = document.querySelector('#preview-video-player canvas');
    expect(findZoomTiles(document, 5)).toEqual([
      {
        id: 'canvas-preview',
        source: canvas,
        rect,
        name: null,
        isSelf: false,
        isShare: false,
        sourceWidth: 700,
        sourceHeight: 394,
        frameKey: 5,
      },
    ]);
  });

  it('reads a player that plays a <video> by its own frame clock', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ stage: STAGE });
    const player = page.addAvatarTile({ rect: LEFT }).ownerDocument.createElement('video-player');
    const video = document.createElement('video');
    for (const [key, value] of Object.entries({
      videoWidth: 640,
      videoHeight: 360,
      currentTime: 2,
    }))
      Object.defineProperty(video, key, { get: () => value, configurable: true });
    page.place(player, RIGHT);
    page.place(video, RIGHT);
    player.append(video);
    document.querySelector('.main-layout')?.append(player);
    expect(findZoomTiles(document, 9).find((tile) => tile.source === video)).toMatchObject({
      id: 'player',
      rect: RIGHT,
      sourceWidth: 640,
      sourceHeight: 360,
      frameKey: 2,
    });
  });

  it('skips a player with nothing to draw', () => {
    createFakeZoomPage(document).showMeeting({ stage: STAGE });
    const player = document.createElement('video-player');
    createFakeZoomPage(document).place(player, LEFT);
    document.querySelector('.main-layout')?.append(player);
    expect(findZoomTiles(document, 1)).toEqual([]);
  });
});
