/** Shared domain types used across page, content script, background and UI. Types only. */

export type RecordingState = 'idle' | 'waiting' | 'recording' | 'paused' | 'stopping';

export type StartRule = 'firstRemote' | 'onJoin';

export type LifecycleCommand = 'start' | 'pause' | 'resume' | 'stop';

export type StopReason =
  | 'command'
  | 'left-meeting'
  | 'pagehide'
  | 'connections-lost'
  | 'encoder-error'
  /** The extension took none of the recording's chunks until they filled the page's limit. */
  | 'backlog-full';

/** 'off' = audio only; 'tiles' = composite the meeting's video tiles and screen share into a video track. */
export type VideoMode = 'off' | 'tiles';

/** Output height of the composited video (16:9, width derived). */
export type VideoHeight = 360 | 540 | 720 | 1080;

/** Axis-aligned box in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The meeting services the recorder understands. */
export type ProviderId = 'meet' | 'zoom' | 'teams';

/** A width and a height in CSS pixels (the window's inner size, the status card's size). */
export interface Size {
  width: number;
  height: number;
}

/**
 * Where the on-page status card sits: on each axis, the window edge it is docked to and its
 * distance in CSS pixels from that edge to the card's near side. Docked to the nearest edges, the
 * card keeps its place when the window grows, and opens away from them.
 */
export interface OverlayPosition {
  horizontal: 'left' | 'right';
  x: number;
  vertical: 'top' | 'bottom';
  y: number;
}

/** What the compositor can draw: a `<video>` (Meet, Teams) or a `<canvas>` (canvas-rendered galleries). */
export type TileSource = HTMLVideoElement | HTMLCanvasElement;

/** A video tile as found in the page DOM by a provider (re-resolved on every composite pass). */
export interface VideoTile {
  /** Participant id when the page exposes one, else a synthetic id derived from the element. */
  id: string;
  /** What to draw; null for a participant shown without any video element (drawn as initials). */
  source: TileSource | null;
  /** On-screen rect (viewport coordinates). */
  rect: Box;
  name: string | null;
  isSelf: boolean;
  /** The screen-share (presentation) tile. */
  isShare: boolean;
  /** Intrinsic size of the source in pixels; 0 when it has no frame (camera off). */
  sourceWidth: number;
  sourceHeight: number;
  /**
   * The region of the source (in source pixels) that shows this tile, for pages that paint several
   * participants into one shared canvas. Absent: the whole source is this tile.
   */
  crop?: Box;
  /** Changes whenever the source shows a new frame (`currentTime` for a `<video>`). */
  frameKey: number;
}

/** Video settings shared by `Settings` and `PageConfig`. */
export interface VideoSettings {
  videoMode: VideoMode;
  /** Composite frame rate (frames per second). */
  videoFps: number;
  videoHeight: VideoHeight;
  /** VP9 target bitrate in bits per second. */
  videoBitsPerSecond: number;
  /** Draw participant names on the tiles. */
  videoLabels: boolean;
  /** Experimental: make the page believe the tab is visible while recording (keeps tiles updating). */
  spoofVisibility: boolean;
}

export interface Settings extends VideoSettings {
  /** Start recording automatically when a call is detected. */
  autoRecord: boolean;
  /** When to start: after the first remote participant's audio arrives, or as soon as connected. */
  startRule: StartRule;
  /** Opus bitrate in bits per second. */
  audioBitsPerSecond: number;
  /** MediaRecorder timeslice in milliseconds (how often a chunk is persisted). */
  timesliceMs: number;
  /** Filename template. Tokens: {date} {time} {title} {code} {provider}. */
  filenameTemplate: string;
  /** Subfolder inside the browser's Downloads directory. */
  downloadSubfolder: string;
  /** Show the on-page REC overlay. */
  overlayEnabled: boolean;
  /** Debug: also save the untouched MediaRecorder output next to the remuxed file. */
  keepRawCopy: boolean;
}

export type RecordingStatus =
  | 'recording'
  | 'ended'
  | 'finalizing'
  | 'saved'
  | 'interrupted'
  | 'failed';

export interface RecordingMeta {
  id: string;
  /** Which service the meeting ran on; absent on recordings made before providers existed (Meet). */
  provider?: ProviderId;
  /** The provider's meeting id (Meet's `abc-defg-hij` code, a Zoom meeting number, …). */
  meetingCode: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  mimeType: string;
  micLabel?: string;
  status: RecordingStatus;
  chunkCount: number;
  byteSize: number;
  /**
   * The saved file's absolute path, set once saved through the downloads API. Show file finds the
   * download by it: Firefox's download ids hold for one browser session only.
   */
  filename?: string;
  error?: string;
  /**
   * True when its tab was lost before it ended: its file is saved, or will be, with "(recovered)".
   * Stored when its save starts, so a save that fails keeps it; absent from recordings stored
   * before that, whose status (`interrupted`) said it until the save.
   */
  recovered?: boolean;
  /** True when the file has a video track. */
  hasVideo?: boolean;
  /** When the last chunk arrived; a fresh value means the page is still delivering. */
  lastChunkAt?: number;
}

/**
 * The meeting page holds as much as it may of chunks the extension has not taken (a full disk, a
 * store that keeps failing): 'audio-only' = a recording with video filled it, so the meeting
 * records audio only until the page has handed that video over; 'waiting' = nothing records until
 * the extension has taken what the page holds of the kind it would record next.
 */
export type BacklogFull = 'audio-only' | 'waiting';

/** Snapshot of what is happening in a meeting tab, mirrored to the background for the badge/popup. */
export interface TabSnapshot {
  state: RecordingState;
  provider: ProviderId;
  /** The provider's meeting id; null when the tab is not showing a meeting. */
  meetingCode: string | null;
  title: string;
  recordingId: string | null;
  recordingStartedAt: number | null;
  remoteTracks: number;
  micLabel: string | null;
  connected: boolean;
  /** Number of tiles in the composited video; absent when no video is being recorded. */
  videoTiles?: number;
  /** The in-call UI is showing (false while knocking in the lobby). */
  admitted: boolean;
  /**
   * Stopped recordings whose chunks or end the page has not handed over yet (the extension took
   * none for a while): the page still claims them. Absent from page sessions older than it.
   */
  pendingRecordingIds?: string[];
  /** Absent while the page holds less than its limit, and from page sessions older than it. */
  backlogFull?: BacklogFull;
}

/** Recorder configuration pushed from the bridge into the page. */
export interface PageConfig extends VideoSettings {
  autoRecord: boolean;
  startRule: StartRule;
  audioBitsPerSecond: number;
  timesliceMs: number;
}

export interface RecordingStartedInfo {
  recordingId: string;
  provider: ProviderId;
  meetingCode: string;
  title: string;
  startedAt: number;
  mimeType: string;
  micLabel: string | null;
  /** True when the recording carries a video track. */
  hasVideo?: boolean;
}

export interface ChunkMessage {
  recordingId: string;
  seq: number;
  blob: Blob;
  /** Milliseconds since the recording started when this chunk was emitted. */
  timestampMs: number;
}

export interface RecordingEndedInfo {
  recordingId: string;
  chunkCount: number;
  durationMs: number;
  reason: StopReason;
}

export interface PageLog {
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Messages a meeting tab sends to the background over the long-lived Port. */
export type TabToBackground =
  | { type: 'hello'; snapshot: TabSnapshot }
  | { type: 'snapshot'; snapshot: TabSnapshot }
  | { type: 'recordingStarted'; info: RecordingStartedInfo }
  | { type: 'chunk'; chunk: ChunkMessage }
  | { type: 'recordingEnded'; info: RecordingEndedInfo }
  | { type: 'log'; log: PageLog }
  | { type: 'ping' };

/** Messages the background sends to a meeting tab. */
export type BackgroundToTab =
  | { type: 'ack'; recordingId: string; seq: number }
  /** The recording's end is stored: the page stops sending its end notice. */
  | { type: 'endAck'; recordingId: string }
  | { type: 'command'; command: LifecycleCommand }
  | { type: 'settings'; settings: Settings }
  | { type: 'saved'; recordingId: string; filename: string; chunkCount: number; byteSize: number }
  | { type: 'error'; recordingId: string | null; message: string };

/** Request/response protocol between the page (MAIN world) and the bridge (ISOLATED world). */
export interface PageProtocolMap extends Record<string, (data: never) => unknown> {
  'page:ready': (data: undefined) => void;
  'page:snapshot': (data: TabSnapshot) => void;
  'page:recordingStarted': (data: RecordingStartedInfo) => void;
  'page:chunk': (data: ChunkMessage) => { ok: true };
  /** Answered once the background stored the end; the page sends it again until then. */
  'page:recordingEnded': (data: RecordingEndedInfo) => { ok: true };
  'page:log': (data: PageLog) => void;
  'bridge:configure': (data: PageConfig) => void;
  'bridge:command': (data: { command: LifecycleCommand }) => void;
}

/** Request/response protocol between popup/options pages and the background. */
export interface TabOverview {
  tabId: number;
  snapshot: TabSnapshot;
}

export interface Overview {
  tabs: TabOverview[];
  recordings: RecordingMeta[];
  settings: Settings;
}

export interface ExtensionProtocolMap {
  getOverview(): Overview;
  sendCommand(data: { tabId: number; command: LifecycleCommand }): void;
  deleteRecording(data: { id: string }): void;
  retryFinalize(data: { id: string }): void;
  showDownload(data: { id: string }): void;
  updateSettings(data: Partial<Settings>): Settings;
  /** Runs a named diagnostic in the background; a test build lets the page ask for one. */
  debugProbe(data: { name: string }): unknown;
  /** Persisted log lines from page, bridge and background (newest last). */
  getDiagnostics(): DiagnosticsEntry[];
  clearDiagnostics(): void;
}

/** One line of the persisted diagnostics log. */
export interface DiagnosticsEntry {
  at: number;
  level: 'info' | 'warn' | 'error';
  /** Where it came from: 'page', 'bridge', 'background'. */
  source: string;
  message: string;
}
