/**
 * Builds Google Meet's call DOM in happy-dom: the call controls (Material Symbols ligatures, which
 * Meet keeps in every UI language), the people badge (`data-avatar-count`, the user included), and
 * a tile per participant carrying `data-participant-id` and a
 * pooled media slot (`data-tile-media-id`), with a `<video>` while the camera is on and none while
 * it is off. The user's tile holds the self view's controls (`frame_person`). A presentation is a
 * second tile of its presenter's id. Names are invented; a person's id follows from their name, so
 * the same call built again keeps every id, and only the media slots move.
 */
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';

interface FakeMeetPerson {
  name: string;
  /** False: the camera is off, the tile shows the person's avatar and no `<video>`. */
  camera?: boolean;
}

interface FakeMeetCallOptions {
  /** The user's own name. */
  self?: string;
  others?: FakeMeetPerson[];
  /** One of `others` presents their screen. */
  share?: { by: string } | null;
}

export interface FakeMeetPage {
  /** "Still trying to get in…": the call controls are there, the tiles are not. */
  showLobby(): void;
  /** In the call: the controls, the user's tile, one tile per person and the presentation. */
  showCall(options?: FakeMeetCallOptions): void;
}

const participantId = (name: string): string => `spaces/x/devices/${encodeURIComponent(name)}`;

export function createFakeMeetPage(doc: Document): FakeMeetPage {
  let slot = 0;
  const controls = (): HTMLElement => {
    const icon = doc.createElement('i');
    icon.className = 'google-symbols';
    icon.textContent = 'call_end';
    return icon;
  };
  const tile = (name: string, options: { camera?: boolean; self?: boolean } = {}) =>
    createFakeVideoTile(doc, {
      participantId: participantId(name),
      tileMediaId: `m${++slot}`,
      name,
      self: options.self ?? false,
      withoutVideo: options.camera === false,
    }).container;
  return {
    showLobby: () => doc.body.append(controls()),
    showCall({ self = 'You', others = [], share = null } = {}) {
      const badge = doc.createElement('span');
      badge.setAttribute('data-avatar-count', String(others.length + 1));
      badge.textContent = String(others.length + 1);
      doc.body.append(
        controls(),
        badge,
        tile(self, { self: true }),
        ...others.map(({ name, camera }) => tile(name, camera === undefined ? {} : { camera })),
        ...(share ? [tile(share.by)] : []),
      );
    },
  };
}
