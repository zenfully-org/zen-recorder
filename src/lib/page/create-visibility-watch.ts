/**
 * Whether the meeting tab is really visible, for the notes' coverage: a hidden tab shows fewer
 * people. It reads the state through `Document.prototype`'s own getter, so the visibility spoof
 * (which overrides it on the document) does not fool it, and hears every change through a
 * capturing listener on the window, which runs before the spoof's on the document. Null when the
 * page has no such getter.
 */
export interface VisibilityWatch {
  visible(): boolean | null;
  dispose(): void;
}

export function createVisibilityWatch(
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
    Document: { prototype: object };
    document: object;
  },
  onChange: (visible: boolean | null) => void,
): VisibilityWatch {
  const getter = Object.getOwnPropertyDescriptor(win.Document.prototype, 'visibilityState')?.get;
  const visible = (): boolean | null => {
    if (typeof getter !== 'function') return null;
    const state: unknown = Reflect.apply(getter, win.document, []);
    return state !== 'hidden';
  };
  const listener = (): void => onChange(visible());
  win.addEventListener('visibilitychange', listener, true);
  return {
    visible,
    dispose: () => win.removeEventListener('visibilitychange', listener, true),
  };
}
