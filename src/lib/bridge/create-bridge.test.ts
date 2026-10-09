import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BackgroundPort, createBackgroundPort } from '@/lib/messaging/create-background-port';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type {
  BackgroundToTab,
  LifecycleCommand,
  RecordingStartedInfo,
  Settings,
  TabSnapshot,
  TabToBackground,
} from '@/lib/types';
import type { OverlayHandle } from '@/lib/ui/mount-overlay';
import { createFakePort, type FakePort } from '@/test/fakes/create-fake-port';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { type BridgeDeps, createBridge } from './create-bridge';

const RECORDING_ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';

function snapshot(patch: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: RECORDING_ID,
    recordingStartedAt: 1,
    remoteTracks: 1,
    micLabel: null,
    connected: true,
    admitted: true,
    ...patch,
  };
}

function started(): RecordingStartedInfo {
  return {
    recordingId: RECORDING_ID,
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    startedAt: 1,
    mimeType: 'video/webm;codecs=vp9,opus',
    micLabel: null,
  };
}

/** An overlay that shows nothing: for a test that only looks at the snapshots it gets. */
function quietOverlay(): Omit<OverlayHandle, 'update'> {
  return {
    toast: () => undefined,
    setEnabled: () => undefined,
    collapse: () => undefined,
    destroy: () => undefined,
  };
}

function setup(
  options: {
    overlay?: boolean;
    ackFails?: boolean;
    /** The background acks nothing: what the bridge relays stays on its way. */
    holdAcks?: boolean;
    /** The bridge's Port to the background, instead of the recording double below. */
    createPort?: BridgeDeps['createPort'];
  } = {},
) {
  const win = createFakeWindow();
  const page = createPageMessenger(win as unknown as Window & typeof globalThis);
  const bridgeMessenger = createPageMessenger(win as unknown as Window & typeof globalThis);
  const received: { type: string; data: unknown }[] = [];
  page.onMessage('bridge:configure', ({ data }) => {
    received.push({ type: 'configure', data });
  });
  page.onMessage('bridge:command', ({ data }) => {
    received.push({ type: 'command', data });
  });

  let onPortMessage: ((message: BackgroundToTab) => void) | null = null;
  const port: BackgroundPort & {
    sent: TabToBackground[];
    chunks: unknown[];
    ends: unknown[];
    closed: boolean;
  } = {
    sent: [],
    chunks: [],
    ends: [],
    closed: false,
    connect: vi.fn(),
    connected: () => true,
    send: (message) => {
      port.sent.push(message);
      return true;
    },
    sendChunk: async (chunk) => {
      if (options.ackFails) throw new Error('no ack');
      port.chunks.push(chunk);
      if (options.holdAcks) await new Promise(() => undefined);
    },
    sendEnd: async (info) => {
      if (options.ackFails) throw new Error('no ack');
      port.ends.push(info);
    },
    close: () => {
      port.closed = true;
    },
  };
  const overlay: OverlayHandle & {
    updates: TabSnapshot[];
    toasts: string[];
    enabled: boolean[];
    destroyed: boolean;
  } = {
    updates: [],
    toasts: [],
    enabled: [],
    destroyed: false,
    update: (s) => overlay.updates.push(s),
    toast: (m, kind) => overlay.toasts.push(`${kind}: ${m}`),
    setEnabled: (v) => overlay.enabled.push(v),
    collapse: () => undefined,
    destroy: () => {
      overlay.destroyed = true;
    },
  };
  let overlayCommand: ((c: LifecycleCommand) => void) | null = null;
  let settingsListener: ((s: Settings) => void) | null = null;
  const unwatch = vi.fn();
  let pageHideListener: (() => void) | null = null;
  const removePageHide = vi.fn();
  const logs: string[] = [];
  const timers: { handler: () => void; ms: number }[] = [];
  const bridge = createBridge({
    messenger: bridgeMessenger,
    createPort:
      options.createPort ??
      ((onMessage) => {
        onPortMessage = onMessage;
        return port;
      }),
    loadSettings: async () => ({ ...getDefaultSettings(), overlayEnabled: false }),
    watchSettings: (listener) => {
      settingsListener = listener;
      return unwatch;
    },
    onPageHide: (listener) => {
      pageHideListener = listener;
      return removePageHide;
    },
    mountOverlay: async (onCommand) => {
      overlayCommand = onCommand;
      return options.overlay === false ? null : overlay;
    },
    setInterval: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    clearInterval: vi.fn(),
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
    },
    keepaliveMs: 5,
  });
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return {
    bridge,
    page,
    received,
    port,
    overlay,
    logs,
    timers,
    unwatch,
    removePageHide,
    flush,
    /** The page goes away (a navigation, a closed tab): Firefox fires `pagehide`. */
    pageHide: () => pageHideListener?.(),
    fromBackground: (m: BackgroundToTab) => onPortMessage?.(m),
    changeSettings: (s: Settings) => settingsListener?.(s),
    clickOverlay: (c: LifecycleCommand) => overlayCommand?.(c),
  };
}

describe('createBridge', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('loads settings, connects, configures the page and mounts the overlay', async () => {
    const { bridge, page, received, port, overlay, timers, flush } = setup();
    await bridge.start();
    await flush();
    expect(port.connect).toHaveBeenCalled();
    expect(received).toEqual([
      {
        type: 'configure',
        data: {
          autoRecord: true,
          startRule: 'firstRemote',
          audioBitsPerSecond: 64_000,
          timesliceMs: 3000,
          videoMode: 'tiles',
          videoFps: 15,
          videoHeight: 1080,
          videoBitsPerSecond: 2_500_000,
          videoLabels: true,
          spoofVisibility: false,
        },
      },
    ]);
    expect(overlay.enabled).toEqual([false]);
    expect(timers[0]?.ms).toBe(5);
    await page.sendMessage('page:ready', undefined);
    await flush();
    expect(received).toHaveLength(2);
  });

  it('relays validated page messages to the background and the overlay', async () => {
    const { bridge, page, port, overlay, logs, flush } = setup();
    await bridge.start();
    const snap = snapshot();
    await page.sendMessage('page:snapshot', snap);
    await page.sendMessage('page:snapshot', { bogus: true } as never);
    const started = {
      recordingId: RECORDING_ID,
      provider: 'meet' as const,
      meetingCode: 'c',
      title: 't',
      startedAt: 1,
      mimeType: 'm',
      micLabel: null,
    };
    await page.sendMessage('page:recordingStarted', started);
    await page.sendMessage('page:recordingStarted', { nope: 1 } as never);
    const chunk = { recordingId: RECORDING_ID, seq: 0, blob: new Blob(['x']), timestampMs: 0 };
    await expect(page.sendMessage('page:chunk', chunk)).resolves.toEqual({ ok: true });
    await expect(page.sendMessage('page:chunk', { seq: 'x' } as never)).rejects.toThrow(
      'malformed chunk',
    );
    const ended = {
      recordingId: RECORDING_ID,
      chunkCount: 1,
      durationMs: 3,
      reason: 'command' as const,
    };
    // Answered once the background acked it, so the page knows it arrived.
    await expect(page.sendMessage('page:recordingEnded', ended)).resolves.toEqual({ ok: true });
    await expect(page.sendMessage('page:recordingEnded', {} as never)).rejects.toThrow(
      'malformed end notice',
    );
    await page.sendMessage('page:log', { level: 'warn', message: 'careful' });
    await page.sendMessage('page:log', { level: 'loud' } as never);
    await flush();
    expect(port.sent).toEqual([
      { type: 'snapshot', snapshot: snap },
      { type: 'recordingStarted', info: started },
      { type: 'log', log: { level: 'warn', message: 'careful' } },
    ]);
    expect(port.chunks).toEqual([chunk]);
    expect(port.ends).toEqual([ended]);
    expect(overlay.updates).toEqual([snap]);
    expect(logs).toEqual(['warn: careful']);
    expect(bridge.getSnapshot()).toEqual(snap);
  });

  it('propagates a failed ack back to the page as a rejection', async () => {
    const { bridge, page } = setup({ ackFails: true });
    await bridge.start();
    const chunk = { recordingId: RECORDING_ID, seq: 0, blob: new Blob(['x']), timestampMs: 0 };
    await expect(page.sendMessage('page:chunk', chunk)).rejects.toThrow('no ack');
    const ended = {
      recordingId: RECORDING_ID,
      chunkCount: 1,
      durationMs: 3,
      reason: 'command' as const,
    };
    await expect(page.sendMessage('page:recordingEnded', ended)).rejects.toThrow('no ack');
  });

  it('refuses an end notice while the Port is down, and delivers it once when the page sends it again', async () => {
    const ports: FakePort[] = [];
    const { bridge, page } = setup({
      createPort: (onMessage) =>
        createBackgroundPort({
          connect: (info) => {
            const port = createFakePort(info.name);
            ports.push(port);
            return port;
          },
          onMessage,
          setTimeout: (handler, ms) => window.setTimeout(handler, ms),
          clearTimeout: (id) => window.clearTimeout(id),
          reconnectDelayMs: 5,
        }),
    });
    await bridge.start();
    const ended = {
      recordingId: RECORDING_ID,
      chunkCount: 4,
      durationMs: 12_000,
      reason: 'command' as const,
    };
    // The event page restarts as the recording stops: the Port is gone for a moment.
    ports[0]?.disconnectFromOtherSide();
    await expect(page.sendMessage('page:recordingEnded', ended)).rejects.toThrow('not connected');
    await vi.waitFor(() => expect(ports).toHaveLength(2));
    const answer = page.sendMessage('page:recordingEnded', ended);
    await vi.waitFor(() =>
      expect(ports[1]?.posted).toContainEqual({ type: 'recordingEnded', info: ended }),
    );
    ports[1]?.receive({ type: 'endAck', recordingId: RECORDING_ID });
    await expect(answer).resolves.toEqual({ ok: true });
    const delivered = ports
      .flatMap((port) => port.posted)
      .filter(
        (m) => typeof m === 'object' && m !== null && 'type' in m && m.type === 'recordingEnded',
      );
    expect(delivered).toEqual([{ type: 'recordingEnded', info: ended }]);
  });

  it('ends the recording on pagehide, on the Port, behind the chunks it relayed', async () => {
    const ports: FakePort[] = [];
    const { bridge, page, pageHide } = setup({
      createPort: (onMessage) =>
        createBackgroundPort({
          connect: (info) => {
            const port = createFakePort(info.name);
            ports.push(port);
            return port;
          },
          onMessage,
          setTimeout: (handler, ms) => window.setTimeout(handler, ms),
          clearTimeout: (id) => window.clearTimeout(id),
        }),
    });
    await bridge.start();
    const posted = () => ports[0]?.posted ?? [];
    await page.sendMessage('page:recordingStarted', started());
    const first = { recordingId: RECORDING_ID, seq: 0, blob: new Blob(['a']), timestampMs: 3000 };
    const firstAnswer = page.sendMessage('page:chunk', first);
    await vi.waitFor(() => expect(posted()).toContainEqual({ type: 'chunk', chunk: first }));
    ports[0]?.receive({ type: 'ack', recordingId: RECORDING_ID, seq: 0 });
    await firstAnswer;
    // Re-announced when a bridge configures the page: the count goes on.
    await page.sendMessage('page:recordingStarted', started());
    // The page goes away while the background has not acked this one yet.
    const second = { recordingId: RECORDING_ID, seq: 1, blob: new Blob(['b']), timestampMs: 6000 };
    void page.sendMessage('page:chunk', second).catch(() => undefined);
    await vi.waitFor(() => expect(posted()).toContainEqual({ type: 'chunk', chunk: second }));
    const before = posted().length;
    // Synchronous: the page and the bridge are gone once the event has run.
    pageHide();
    expect(posted().slice(before)).toEqual([
      {
        type: 'log',
        log: {
          level: 'info',
          message: `the page went away: recording ${RECORDING_ID} ended (pagehide) after 2 chunks`,
        },
      },
      {
        type: 'recordingEnded',
        info: { recordingId: RECORDING_ID, chunkCount: 2, durationMs: 6000, reason: 'pagehide' },
      },
    ]);
    // A second pagehide (the page came back from the cache and went again) ends nothing twice.
    pageHide();
    expect(posted()).toHaveLength(before + 2);
  });

  it('leaves a recording whose end the background acked alone on pagehide', async () => {
    const { bridge, page, port, pageHide } = setup();
    await bridge.start();
    pageHide();
    await page.sendMessage('page:recordingStarted', started());
    const chunk = { recordingId: RECORDING_ID, seq: 0, blob: new Blob(['a']), timestampMs: 3000 };
    await page.sendMessage('page:chunk', chunk);
    const ended = {
      recordingId: RECORDING_ID,
      chunkCount: 1,
      durationMs: 3100,
      reason: 'command' as const,
    };
    await page.sendMessage('page:recordingEnded', ended);
    pageHide();
    expect(port.sent.filter((m) => m.type === 'recordingEnded' || m.type === 'log')).toEqual([]);
  });

  it('ends on pagehide every recording whose end is still on its way, and one without a chunk', async () => {
    // Nothing reaches the background: the end of the recording before it is refused, and the
    // page would send it again after a second.
    const { bridge, page, port, pageHide } = setup({ ackFails: true });
    await bridge.start();
    const failed = '0b6f2c1e-7d4a-4c3b-8e2f-1a9d8c7b6a50';
    const chunk = { recordingId: failed, seq: 0, blob: new Blob(['a']), timestampMs: 2500 };
    await expect(page.sendMessage('page:chunk', chunk)).rejects.toThrow('no ack');
    await expect(
      page.sendMessage('page:recordingEnded', {
        recordingId: failed,
        chunkCount: 1,
        durationMs: 2600,
        reason: 'encoder-error',
      }),
    ).rejects.toThrow('no ack');
    await page.sendMessage('page:recordingStarted', started());
    pageHide();
    expect(port.sent.filter((m) => m.type === 'recordingEnded')).toEqual([
      {
        type: 'recordingEnded',
        info: { recordingId: failed, chunkCount: 1, durationMs: 2500, reason: 'pagehide' },
      },
      {
        type: 'recordingEnded',
        info: { recordingId: RECORDING_ID, chunkCount: 0, durationMs: 0, reason: 'pagehide' },
      },
    ]);
  });

  it('handles background messages: commands, settings, saved, error, ack', async () => {
    const { bridge, received, overlay, logs, fromBackground, flush } = setup();
    await bridge.start();
    await flush();
    fromBackground({ type: 'command', command: 'pause' });
    fromBackground({
      type: 'settings',
      settings: { ...getDefaultSettings(), overlayEnabled: true, timesliceMs: 1000 },
    });
    fromBackground({
      type: 'saved',
      recordingId: RECORDING_ID,
      filename: 'a.webm',
      chunkCount: 2,
      byteSize: 10,
    });
    fromBackground({ type: 'error', recordingId: null, message: 'boom' });
    fromBackground({ type: 'ack', recordingId: RECORDING_ID, seq: 0 });
    await flush();
    expect(received).toContainEqual({ type: 'command', data: { command: 'pause' } });
    expect(received.at(-1)).toEqual({
      type: 'configure',
      data: {
        autoRecord: true,
        startRule: 'firstRemote',
        audioBitsPerSecond: 64_000,
        timesliceMs: 1000,
        videoMode: 'tiles',
        videoFps: 15,
        videoHeight: 1080,
        videoBitsPerSecond: 2_500_000,
        videoLabels: true,
        spoofVisibility: false,
      },
    });
    expect(overlay.enabled).toEqual([false, true]);
    expect(overlay.toasts).toEqual([
      'ok: Recording saved: a.webm',
      'error: Zen Recorder error: boom',
    ]);
    expect(logs).toEqual(['info: saved a.webm (2 chunks, 10 bytes raw)']);
  });

  it('reacts to settings changes from storage and forwards overlay clicks', async () => {
    const { bridge, received, overlay, changeSettings, clickOverlay, flush } = setup();
    await bridge.start();
    changeSettings({ ...getDefaultSettings(), autoRecord: false, overlayEnabled: true });
    clickOverlay('stop');
    await flush();
    expect(received.at(-2)).toMatchObject({ type: 'configure', data: { autoRecord: false } });
    expect(received.at(-1)).toEqual({ type: 'command', data: { command: 'stop' } });
    expect(overlay.enabled).toEqual([false, true]);
  });

  it('pings the background only while a recording is active', async () => {
    const { bridge, page, port, timers, flush } = setup();
    await bridge.start();
    const tick = () => timers[0]?.handler();
    tick();
    await page.sendMessage('page:snapshot', snapshot({ state: 'idle' }));
    tick();
    await page.sendMessage('page:snapshot', snapshot({ state: 'paused' }));
    tick();
    // Paused before the next recording starts on Resume: no recording, still a session.
    await page.sendMessage(
      'page:snapshot',
      snapshot({ state: 'paused', recordingId: null, recordingStartedAt: null }),
    );
    tick();
    await flush();
    expect(port.sent.filter((m) => m.type === 'ping')).toHaveLength(2);
  });

  it('works without an overlay and shows the latest snapshot once one mounts', async () => {
    const { bridge, page, overlay, flush } = setup({ overlay: false });
    await bridge.start();
    await page.sendMessage('page:snapshot', snapshot());
    await flush();
    expect(overlay.updates).toEqual([]);
    expect(bridge.getSnapshot()?.state).toBe('recording');
  });

  it('updates a late-mounting overlay with the snapshot received during mount', async () => {
    const win = createFakeWindow();
    const page = createPageMessenger(win as unknown as Window & typeof globalThis);
    const bridgeMessenger = createPageMessenger(win as unknown as Window & typeof globalThis);
    const overlay: OverlayHandle & { updates: TabSnapshot[] } = {
      ...quietOverlay(),
      updates: [],
      update: (s) => overlay.updates.push(s),
    };
    const mount: { resolve: ((o: OverlayHandle) => void) | null } = { resolve: null };
    const bridge = createBridge({
      messenger: bridgeMessenger,
      createPort: () => ({
        connect() {},
        connected: () => true,
        send: () => true,
        sendChunk: async () => {},
        sendEnd: async () => {},
        close() {},
      }),
      loadSettings: async () => getDefaultSettings(),
      watchSettings: () => () => undefined,
      onPageHide: () => () => undefined,
      mountOverlay: () =>
        new Promise((resolve) => {
          mount.resolve = resolve;
        }),
      setInterval: () => 1,
      clearInterval: () => undefined,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    const started = bridge.start();
    await new Promise((r) => setTimeout(r, 5));
    await page.sendMessage('page:snapshot', snapshot());
    mount.resolve?.(overlay);
    await started;
    expect(overlay.updates).toEqual([snapshot()]);
    bridge.dispose();
  });

  it('dispose tears everything down', async () => {
    const { bridge, port, overlay, unwatch, removePageHide, flush } = setup();
    await bridge.start();
    await flush();
    bridge.dispose();
    expect(port.closed).toBe(true);
    expect(overlay.destroyed).toBe(true);
    expect(unwatch).toHaveBeenCalled();
    expect(removePageHide).toHaveBeenCalled();
    bridge.dispose();
  });
});

describe('createBridge when the page hands over what it holds as it goes away', () => {
  const chunk = (seq: number) => ({
    recordingId: RECORDING_ID,
    seq,
    blob: new Blob([`c${seq}`]),
    timestampMs: seq * 3000,
  });
  const end = (chunkCount: number) => ({
    recordingId: RECORDING_ID,
    chunkCount,
    durationMs: 8000,
    reason: 'pagehide' as const,
  });

  it("relays, inside pagehide, what the background neither has nor has on its way, then the page's end, and no end of its own", async () => {
    const { bridge, page, port, pageHide } = setup({ holdAcks: true });
    await bridge.start();
    await page.sendMessage('page:recordingStarted', started());
    // On its way: posted on the Port, not acked yet.
    void page.sendMessage('page:chunk', chunk(0)).catch(() => undefined);
    await vi.waitFor(() => expect(port.chunks).toHaveLength(1));
    const before = port.sent.length;
    const held = { recordingId: RECORDING_ID, chunks: [chunk(0), chunk(1), chunk(2)], end: end(3) };
    page.notifySync('page:handover', { recordings: [held] });
    pageHide();
    expect(port.sent.slice(before)).toEqual([
      { type: 'chunk', chunk: chunk(1) },
      { type: 'chunk', chunk: chunk(2) },
      { type: 'recordingEnded', info: end(3) },
      {
        type: 'log',
        log: {
          level: 'info',
          message: `the page went away: it handed over 2 more chunks of recording ${RECORDING_ID} and its end (3 chunks in all)`,
        },
      },
    ]);
  });

  it('asks the page on pagehide to hand over again, before its own end: Firefox may have cut the first short', async () => {
    const { bridge, page, port, pageHide } = setup();
    await bridge.start();
    await page.sendMessage('page:recordingStarted', started());
    const held = { recordingId: RECORDING_ID, chunks: [chunk(0)], end: end(1) };
    // The page's own handover never reached the bridge; asked again, it hands over everything.
    page.onSync('bridge:handover', () => page.notifySync('page:handover', { recordings: [held] }));
    pageHide();
    expect(port.sent.filter((m) => m.type !== 'log')).toEqual([
      { type: 'recordingStarted', info: started() },
      { type: 'chunk', chunk: chunk(0) },
      { type: 'recordingEnded', info: end(1) },
    ]);
  });

  it('ignores a malformed handover: its own end on pagehide still ends the recording', async () => {
    const { bridge, page, port, pageHide } = setup();
    await bridge.start();
    await page.sendMessage('page:recordingStarted', started());
    page.notifySync('page:handover', {
      recordings: [{ recordingId: 'not-a-recording', chunks: [], end: null }],
    });
    pageHide();
    expect(port.sent.filter((m) => m.type === 'recordingEnded')).toEqual([
      { type: 'recordingEnded', info: { ...end(0), durationMs: 0 } },
    ]);
  });

  it('relays the chunks of a recording whose stop was under way, then ends it itself, counting them', async () => {
    const { bridge, page, port, pageHide } = setup();
    await bridge.start();
    await page.sendMessage('page:recordingStarted', started());
    page.notifySync('page:handover', {
      recordings: [{ recordingId: RECORDING_ID, chunks: [chunk(0), chunk(1)], end: null }],
    });
    pageHide();
    expect(port.sent.filter((m) => m.type !== 'log').slice(-3)).toEqual([
      { type: 'chunk', chunk: chunk(0) },
      { type: 'chunk', chunk: chunk(1) },
      { type: 'recordingEnded', info: { ...end(2), durationMs: 3000 } },
    ]);
  });
});
