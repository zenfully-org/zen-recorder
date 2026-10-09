import {
  CircleDot,
  ClipboardCopy,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { recordingsClaimedBy } from '@/lib/background/recordings-claimed-by';
import { cn } from '@/lib/cn';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { getProviderCatalog } from '@/lib/providers/get-provider-catalog';
import type {
  BacklogFull,
  LifecycleCommand,
  Overview,
  ProviderId,
  RecordingMeta,
  TabSnapshot,
} from '@/lib/types';
import { copyDiagnostics } from '@/lib/ui/copy-diagnostics';
import { describeBacklogAlert } from '@/lib/ui/describe-backlog-alert';
import { describeRecordingRow } from '@/lib/ui/describe-recording-row';
import { describeTabState } from '@/lib/ui/describe-tab-state';
import { formatElapsed } from '@/lib/ui/format-elapsed';
import { formatTabActivity } from '@/lib/ui/format-tab-activity';
import { runPopupRequest } from '@/lib/ui/run-popup-request';
import { type RecordingAction, runRecordingAction } from '@/lib/ui/run-recording-action';
import { runTabCommand } from '@/lib/ui/run-tab-command';

const PROVIDERS = getProviderCatalog();
const { sendMessage } = getExtensionMessaging();

function providerLabel(id: ProviderId | undefined): string {
  // Recordings stored before providers existed are Google Meet ones.
  return PROVIDERS.find((provider) => provider.id === (id ?? 'meet'))?.label ?? 'Meeting';
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function useOverview(intervalMs: number): [Overview | null, () => Promise<void>] {
  const [overview, setOverview] = useState<Overview | null>(null);
  const refresh = useCallback(async () => {
    try {
      setOverview(await sendMessage('getOverview', undefined));
    } catch (error) {
      console.error('getOverview failed', error);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);
  return [overview, refresh];
}

/** Asks for the host permissions of every provider the user has not granted yet. */
function PermissionBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  // What the last check or Grant access could not do: a failed click is never silent.
  const [failure, setFailure] = useState<string | null>(null);
  const check = useCallback(async () => {
    setFailure(
      await runPopupRequest('Could not check the access to the meeting sites', async () => {
        const granted = await Promise.all(
          PROVIDERS.map((provider) => browser.permissions.contains({ origins: provider.origins })),
        );
        setMissing(PROVIDERS.filter((_, index) => !granted[index]).map((provider) => provider.id));
      }),
    );
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  const blocked = PROVIDERS.filter((provider) => missing.includes(provider.id));
  if (blocked.length === 0 && failure === null) return null;
  const grant = async () => {
    // Firefox asks only while the click is being handled: the request goes out before any await.
    const asked = await runPopupRequest('Could not ask for access', () =>
      browser.permissions.request({ origins: blocked.flatMap((provider) => provider.origins) }),
    );
    if (asked === null) await check();
    else setFailure(asked);
  };
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col gap-2 p-3 text-sm">
        {blocked.length > 0 && (
          <>
            <p>
              Zen Recorder needs access to {blocked.map((provider) => provider.label).join(', ')} to
              detect and record calls there.
            </p>
            <Button size="sm" onClick={() => void grant()}>
              Grant access
            </Button>
          </>
        )}
        <p role="alert" className="text-destructive text-xs empty:hidden">
          {failure}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * What the tab's status card says when its page holds as much as it may of what could not be saved
 * yet: the video stopped, or nothing records.
 */
function BacklogAlertLine({ backlogFull }: { backlogFull: BacklogFull | undefined }) {
  const alert = describeBacklogAlert(backlogFull);
  if (!alert) return null;
  return (
    <p role="status" className="text-amber-700 text-xs dark:text-amber-400">
      <span className="font-medium">{alert.label}.</span> {alert.detail}
    </p>
  );
}

function TabCard({
  tabId,
  snapshot,
  onCommand,
}: {
  tabId: number;
  snapshot: TabSnapshot;
  onCommand: (tabId: number, c: LifecycleCommand) => void;
}) {
  const active = snapshot.state === 'recording' || snapshot.state === 'paused';
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <CircleDot
            className={cn(
              'size-4 shrink-0 text-muted-foreground',
              snapshot.state === 'recording' && 'animate-pulse text-red-500',
              snapshot.state === 'paused' && 'text-amber-500',
            )}
          />
          <span className="min-w-0 flex-1 truncate font-medium" title={snapshot.meetingCode ?? ''}>
            {snapshot.title}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {providerLabel(snapshot.provider)}
          </span>
          <Badge variant={snapshot.state === 'recording' ? 'destructive' : 'secondary'}>
            {describeTabState(snapshot)}
          </Badge>
        </div>
        <div className="flex gap-3 text-muted-foreground text-xs">
          <span className="tabular-nums">{formatTabActivity(snapshot, Date.now())}</span>
          <span className="min-w-0 flex-1 truncate" title={snapshot.micLabel ?? ''}>
            {snapshot.micLabel ? `mic: ${snapshot.micLabel}` : 'mic: not detected yet'}
          </span>
          {active && snapshot.videoTiles !== undefined && (
            <span className="shrink-0" title="video tiles being recorded">
              🎥 {snapshot.videoTiles}
            </span>
          )}
        </div>
        <BacklogAlertLine backlogFull={snapshot.backlogFull} />
        <div className="flex gap-2">
          {(snapshot.state === 'waiting' || snapshot.state === 'idle') && (
            <Button size="sm" onClick={() => onCommand(tabId, 'start')}>
              <CircleDot /> Record now
            </Button>
          )}
          {snapshot.state === 'recording' && (
            <Button size="sm" variant="secondary" onClick={() => onCommand(tabId, 'pause')}>
              <Pause /> Pause
            </Button>
          )}
          {snapshot.state === 'paused' && (
            <Button size="sm" variant="secondary" onClick={() => onCommand(tabId, 'resume')}>
              <Play /> Resume
            </Button>
          )}
          {active && (
            <Button size="sm" variant="destructive" onClick={() => onCommand(tabId, 'stop')}>
              <Square /> Stop &amp; save
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecordingRow({
  meta,
  claimedIds,
  onChange,
}: {
  meta: RecordingMeta;
  /** The recordings the connected meeting tabs still deliver. */
  claimedIds: ReadonlySet<string>;
  onChange: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const row = describeRecordingRow(meta, { claimedIds, now: Date.now() });
  const act = async (action: RecordingAction) => {
    if (action === 'deleteRecording' && !confirm(row.removeQuestion)) return;
    setFailure(await runRecordingAction(action, meta.id, sendMessage));
    onChange();
  };
  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border p-2.5',
        row.attention && 'border-destructive',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={meta.filename ?? meta.title}>
          {meta.title}
        </span>
        <span className="text-muted-foreground text-xs">{formatDate(meta.startedAt)}</span>
      </div>
      <div className="flex gap-3 text-muted-foreground text-xs">
        <span className="tabular-nums">
          {meta.durationMs === undefined ? '–' : formatElapsed(meta.durationMs)}
        </span>
        <span>{formatBytes(meta.byteSize)}</span>
        <span>{providerLabel(meta.provider)}</span>
        {meta.hasVideo && <span title="includes video">🎥</span>}
        <span className="min-w-0 flex-1 truncate">{row.status}</span>
      </div>
      <div className="flex gap-1.5">
        {row.actions.includes('showDownload') && (
          <Button size="sm" variant="outline" onClick={() => void act('showDownload')}>
            <FolderOpen /> Show file
          </Button>
        )}
        {row.actions.includes('retryFinalize') && (
          <Button size="sm" variant="outline" onClick={() => void act('retryFinalize')}>
            <RotateCcw /> Retry save
          </Button>
        )}
        {row.actions.includes('deleteRecording') && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => void act('deleteRecording')}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <p role="alert" className="text-destructive text-xs empty:hidden">
        {failure}
      </p>
    </li>
  );
}

export function App() {
  const [overview, refresh] = useOverview(1000);
  const claimedIds = new Set(recordingsClaimedBy(overview?.tabs.map((t) => t.snapshot) ?? []));
  const [copied, setCopied] = useState(false);
  // What the last header button or meeting command could not do: a failed click is never silent.
  const [headerFailure, setHeaderFailure] = useState<string | null>(null);
  const [commandFailure, setCommandFailure] = useState<string | null>(null);
  const onDiagnostics = async () => {
    const failure = await copyDiagnostics({
      load: () => sendMessage('getDiagnostics', undefined),
      writeText: (text) => navigator.clipboard.writeText(text),
    });
    setHeaderFailure(failure);
    if (failure !== null) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  // The failure shows above the cards: a card whose tab is gone disappears at the next refresh.
  const onCommand = async (tabId: number, command: LifecycleCommand) => {
    setCommandFailure(await runTabCommand(command, tabId, sendMessage));
    await refresh();
  };
  return (
    <main className="flex w-[360px] flex-col gap-3 p-3 text-sm">
      <header className="flex items-center gap-2">
        <h1 className="flex-1 font-semibold text-base">Zen Recorder</h1>
        <Button size="sm" variant="ghost" onClick={() => void onDiagnostics()}>
          <ClipboardCopy /> {copied ? 'Copied' : 'Diagnostics'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void runPopupRequest('Could not open the settings', () =>
              browser.runtime.openOptionsPage(),
            ).then(setHeaderFailure)
          }
        >
          <Settings2 /> Settings
        </Button>
      </header>
      <p role="alert" className="text-destructive text-xs empty:hidden">
        {headerFailure}
      </p>
      <PermissionBanner />
      <section className="flex flex-col gap-2">
        <p role="alert" className="text-destructive text-xs empty:hidden">
          {commandFailure}
        </p>
        {overview === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : overview.tabs.length === 0 ? (
          <p className="text-muted-foreground">
            No meeting tab open ({PROVIDERS.map((provider) => provider.label).join(', ')}).
            Recording starts automatically when you join a call
            {overview.settings.autoRecord ? '' : ' (auto-record is off)'}.
          </p>
        ) : (
          overview.tabs.map((t) => (
            <TabCard
              key={t.tabId}
              tabId={t.tabId}
              snapshot={t.snapshot}
              onCommand={(id, c) => void onCommand(id, c)}
            />
          ))
        )}
      </section>
      <Separator />
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Recordings
        </h2>
        {overview && overview.recordings.length === 0 && (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        )}
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto">
          {overview?.recordings.map((meta) => (
            <RecordingRow
              key={meta.id}
              meta={meta}
              claimedIds={claimedIds}
              onChange={() => void refresh()}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}
