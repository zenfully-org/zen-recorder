import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { getProjectTexts } from '@/lib/project/get-project-texts';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { loadSettings } from '@/lib/settings/load-settings';
import { saveSettings } from '@/lib/settings/save-settings';
import type { MeetingNotesMode, Settings } from '@/lib/types';

const BITRATES = [32_000, 48_000, 64_000, 96_000, 128_000];
const VIDEO_HEIGHTS = [360, 540, 720, 1080] as const;
const VIDEO_FPS = [5, 10, 15, 24, 30];
const VIDEO_BITRATES = [800_000, 1_500_000, 2_500_000, 4_000_000, 6_000_000];

const mbPerHour = (bitsPerSecond: number) => Math.round((bitsPerSecond / 8 / 1048576) * 3600);

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <Label>{label}</Label>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const NOTES_MODES = ['off', 'withoutNames', 'withNames'] as const;

/** The meeting notes setting: none, the timeline without names, or with the names shown. */
function MeetingNotesCard({
  value,
  onChange,
}: {
  value: MeetingNotesMode;
  onChange: (mode: MeetingNotesMode) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting notes</CardTitle>
        <CardDescription>
          A Markdown file next to each recording: the meeting's title, link and date, and what
          happened during it, each with its position in the recording. Participant names are
          included only with the last option; the meeting title is always kept. Saved only on this
          computer, like the recording.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Row label="Notes file">
          <Select
            value={value}
            onValueChange={(v) => {
              const mode = NOTES_MODES.find((candidate) => candidate === v);
              if (mode) onChange(mode);
            }}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="withoutNames">Timeline only (no names)</SelectItem>
              <SelectItem value="withNames">Timeline and participant names</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </CardContent>
    </Card>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) return <main className="p-8 text-muted-foreground">Loading…</main>;

  const update = async (patch: Partial<Settings>) => {
    setSettings(await saveSettings(patch));
    setSaved(true);
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-8">
      <div>
        <h1 className="font-semibold text-2xl">Zen Recorder settings</h1>
        <p className="text-muted-foreground text-sm">
          Recordings are saved to your browser's Downloads folder. Changes apply immediately,
          including to open meeting tabs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recording</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Row
            label="Record automatically"
            hint="Start when you join a Google Meet, Zoom or Microsoft Teams call"
          >
            <Switch
              checked={settings.autoRecord}
              onCheckedChange={(v) => void update({ autoRecord: v })}
            />
          </Row>
          <Row label="Start recording">
            <Select
              value={settings.startRule}
              onValueChange={(v) =>
                void update({ startRule: v === 'onJoin' ? 'onJoin' : 'firstRemote' })
              }
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="firstRemote">
                  when the first other participant's audio arrives
                </SelectItem>
                <SelectItem value="onJoin">
                  as soon as the call is connected (even alone)
                </SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Audio quality (Opus)">
            <Select
              value={String(settings.audioBitsPerSecond)}
              onValueChange={(v) => void update({ audioBitsPerSecond: Number(v) })}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BITRATES.map((b) => (
                  <SelectItem key={b} value={String(b)}>
                    {b / 1000} kbps (~{Math.round((b / 8 / 1048576) * 3600)} MB per hour)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="REC indicator" hint="Show the overlay on the meeting page">
            <Switch
              checked={settings.overlayEnabled}
              onCheckedChange={(v) => void update({ overlayEnabled: v })}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Video</CardTitle>
          <CardDescription>
            Records the meeting's video tiles and shared screens, laid out as on screen, alongside
            the audio. Needs WebCodecs (unavailable with resistFingerprinting: audio-only then).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Row label="Record video" hint="Off = audio only">
            <Switch
              checked={settings.videoMode === 'tiles'}
              onCheckedChange={(v) => void update({ videoMode: v ? 'tiles' : 'off' })}
            />
          </Row>
          <Row label="Resolution">
            <Select
              value={String(settings.videoHeight)}
              onValueChange={(v) => {
                const videoHeight = VIDEO_HEIGHTS.find((height) => String(height) === v);
                if (videoHeight) void update({ videoHeight });
              }}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_HEIGHTS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h}p ({Math.round((h * 16) / 9)}×{h})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Frame rate" hint="Lower rates use less CPU on the meeting tab">
            <Select
              value={String(settings.videoFps)}
              onValueChange={(v) => void update({ videoFps: Number(v) })}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_FPS.map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Video quality (VP9)">
            <Select
              value={String(settings.videoBitsPerSecond)}
              onValueChange={(v) => void update({ videoBitsPerSecond: Number(v) })}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_BITRATES.map((b) => (
                  <SelectItem key={b} value={String(b)}>
                    {b / 1_000_000} Mbps (~{mbPerHour(b + settings.audioBitsPerSecond)} MB per hour)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Name labels" hint="Draw participant names on the tiles">
            <Switch
              checked={settings.videoLabels}
              onCheckedChange={(v) => void update({ videoLabels: v })}
            />
          </Row>
          <Row
            label="Keep tiles updating in background tabs (experimental)"
            hint="Makes the meeting page believe the tab is visible while recording"
          >
            <Switch
              checked={settings.spoofVisibility}
              onCheckedChange={(v) => void update({ spoofVisibility: v })}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Tokens for the template: {'{date} {time} {title} {code} {provider}'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Row label="Subfolder inside Downloads">
            <Input
              className="w-72"
              value={settings.downloadSubfolder}
              onChange={(e) => setSettings({ ...settings, downloadSubfolder: e.target.value })}
              onBlur={(e) => void update({ downloadSubfolder: e.target.value })}
            />
          </Row>
          <Row label="Filename template" hint={`Default: ${getDefaultSettings().filenameTemplate}`}>
            <Input
              className="w-72"
              value={settings.filenameTemplate}
              onChange={(e) => setSettings({ ...settings, filenameTemplate: e.target.value })}
              onBlur={(e) => void update({ filenameTemplate: e.target.value })}
            />
          </Row>
        </CardContent>
      </Card>

      <MeetingNotesCard
        value={settings.meetingNotes}
        onChange={(meetingNotes) => void update({ meetingNotes })}
      />

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Row
            label="Chunk interval (seconds)"
            hint="How often audio is persisted. Smaller loses less on a crash."
          >
            <Input
              className="w-24"
              type="number"
              min={1}
              max={30}
              value={settings.timesliceMs / 1000}
              onChange={(e) =>
                void update({ timesliceMs: Math.max(1, Number(e.target.value)) * 1000 })
              }
            />
          </Row>
          <Row
            label="Keep raw copy"
            hint="Also save the untouched MediaRecorder output (debugging)"
          >
            <Switch
              checked={settings.keepRawCopy}
              onCheckedChange={(v) => void update({ keepRawCopy: v })}
            />
          </Row>
          <div>
            <Button variant="outline" onClick={() => void update(getDefaultSettings())}>
              Reset to defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {saved && <p className="text-muted-foreground text-xs">Saved.</p>}

      <footer className="flex flex-col gap-1 border-t pt-4 text-muted-foreground text-xs">
        <p>
          {getProjectTexts().name} {browser.runtime.getManifest().version}
        </p>
        <p>{getProjectTexts().notice}</p>
      </footer>
    </main>
  );
}
