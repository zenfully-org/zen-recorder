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
import { cn } from '@/lib/cn';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { getProviderCatalog } from '@/lib/providers/get-provider-catalog';
import type {
  LifecycleCommand,
  Overview,
  ProviderId,
  RecordingMeta,
  TabSnapshot,
} from '@/lib/types';
import { formatElapsed } from '@/lib/ui/format-elapsed';
import { formatTabActivity } from '@/lib/ui/format-tab-activity';
import { type RecordingAction, runRecordingAction } from '@/lib/ui/run-recording-action';

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

function stateLabel(s: TabSnapshot): string {
  switch (s.state) {
    case 'recording':
      return 'Recording';
    case 'paused':
      return 'Paused';
    case 'stopping':
      return 'Saving…';
    case 'waiting':
      return s.remoteTracks > 0 ? 'Ready' : 'Waiting for participants';
    case 'idle':
      return s.meetingCode ? 'Not connected' : 'No meeting';
  }
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
  const check = useCallback(async () => {
    const granted = await Promise.all(
      PROVIDERS.map((provider) => browser.permissions.contains({ origins: provider.origins })),
    );
    setMissing(PROVIDERS.filter((_, index) => !granted[index]).map((provider) => provider.id));
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  const blocked = PROVIDERS.filter((provider) => missing.includes(provider.id));
  if (blocked.length === 0) return null;
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col gap-2 p-3 text-sm">
        <p>
          Zen Recorder needs access to {blocked.map((provider) => provider.label).join(', ')} to
          detect and record calls there.
        </p>
        <Button
          size="sm"
          onClick={() =>
            void browser.permissions
              .request({ origins: blocked.flatMap((provider) => provider.origins) })
              .then(check)
          }
        >
          Grant access
        </Button>
      </CardContent>
    </Card>
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
            {stateLabel(snapshot)}
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

function RecordingRow({ meta, onChange }: { meta: RecordingMeta; onChange: () => void }) {
  const [failure, setFailure] = useState<string | null>(null);
  const act = async (action: RecordingAction) => {
    if (action === 'deleteRecording' && !confirm('Remove this entry? The saved file is kept.'))
      return;
    setFailure(await runRecordingAction(action, meta.id, sendMessage));
    onChange();
  };
  const status =
    meta.status === 'saved'
      ? meta.recovered
        ? 'saved (recovered)'
        : 'saved'
      : meta.status === 'failed'
        ? `failed: ${meta.error ?? 'unknown error'}`
        : meta.status;
  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border p-2.5',
        meta.status === 'failed' && 'border-destructive',
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
        <span className="min-w-0 flex-1 truncate">{status}</span>
      </div>
      <div className="flex gap-1.5">
        {meta.status === 'saved' && (
          <Button size="sm" variant="outline" onClick={() => void act('showDownload')}>
            <FolderOpen /> Show file
          </Button>
        )}
        {(meta.status === 'failed' || meta.status === 'interrupted') && (
          <Button size="sm" variant="outline" onClick={() => void act('retryFinalize')}>
            <RotateCcw /> Retry save
          </Button>
        )}
        {meta.status !== 'recording' && meta.status !== 'finalizing' && (
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
  const [copied, setCopied] = useState(false);
  const copyDiagnostics = async () => {
    const entries = await sendMessage('getDiagnostics', undefined);
    const text = entries
      .map((e) => `${new Date(e.at).toISOString()}\t${e.level}\t${e.source}\t${e.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text || '(diagnostics log is empty)');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const onCommand = async (tabId: number, command: LifecycleCommand) => {
    await sendMessage('sendCommand', { tabId, command });
    await refresh();
  };
  return (
    <main className="flex w-[360px] flex-col gap-3 p-3 text-sm">
      <header className="flex items-center gap-2">
        <h1 className="flex-1 font-semibold text-base">Zen Recorder</h1>
        <Button size="sm" variant="ghost" onClick={() => void copyDiagnostics()}>
          <ClipboardCopy /> {copied ? 'Copied' : 'Diagnostics'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void browser.runtime.openOptionsPage()}>
          <Settings2 /> Settings
        </Button>
      </header>
      <PermissionBanner />
      <section className="flex flex-col gap-2">
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
            <RecordingRow key={meta.id} meta={meta} onChange={() => void refresh()} />
          ))}
        </ul>
      </section>
    </main>
  );
}
