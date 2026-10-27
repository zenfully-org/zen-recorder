// @vitest-environment node
/**
 * `scripts/ci/install-e2e-packages.sh` installs the packages CI's end-to-end jobs need from a
 * folder of cached `.deb` files, and lets apt-get download what the folder lacks. Here fakes stand
 * in for `sudo`, `apt-get`, `dpkg` and `dpkg-query`: they record each call (apt-get with the
 * mirror the mirror list puts first) and keep a fake package database, so each case decides what
 * the runner image has, what the cached files bring and which mirror is slow.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from '../process-budget';

const SCRIPT = path.resolve(import.meta.dirname, 'install-e2e-packages.sh');

// The database is one line per package and status, the last line of a package winning.
const FAKES = {
  sudo: `#!/usr/bin/env bash
exec "$@"
`,
  // A call while a slow mirror is first hangs until the script's time limit stops it. An install
  // wants the named packages not installed yet, or with --fix-broken the libraries of
  // FAKE_MISSING and whatever dpkg left unpacked; a download writes their files, an install
  // without download installs them.
  'apt-get': `#!/usr/bin/env bash
first="$(grep -vE '^[[:space:]]*(#|$)' "$APT_MIRROR_LIST" | head -n 1 | cut -f1)"
printf 'apt-get\\t%s\\t%s\\n' "$first" "$*" >>"$FAKE_LOG"
for slow in \${FAKE_SLOW_MIRRORS:-}; do [[ $first == "$slow" ]] && exec sleep 30; done
wanted=(); command=''
for arg; do
  [[ $arg == Dir::Cache::archives=* ]] && archives="\${arg#*=}"
  [[ -n $command && $arg != -* && $(grep "^$arg " "$FAKE_DATABASE" | tail -n 1) != "$arg installed" ]] && wanted+=("$arg")
  [[ $arg == install ]] && command=install
done
if [[ " $* " == *' --fix-broken '* ]]; then
  wanted=(\${FAKE_MISSING:-})
  [[ " $* " == *' --no-download '* ]] && wanted+=($(grep ' unpacked$' "$FAKE_DATABASE" | cut -d' ' -f1))
fi
if [[ " $* " == *' --download-only '* ]]; then
  [[ -d $archives/partial ]] || { echo "E: Archives directory $archives/partial is missing." >&2; exit 100; }
  for package in "\${wanted[@]}"; do touch "$archives/\${package}_1.0_amd64.deb"; done
elif [[ " $* " == *' --no-download '* ]]; then
  for package in "\${wanted[@]}"; do echo "$package installed" >>"$FAKE_DATABASE"; done
fi
`,
  // Installs every file it gets, or with FAKE_DPKG_FAILS leaves them unpacked, as a missing
  // dependency does.
  dpkg: `#!/usr/bin/env bash
args=(); for arg; do [[ $arg == *.deb ]] && arg="$(basename "$arg")"; args+=("$arg"); done
printf 'dpkg\\t%s\\n' "\${args[*]}" >>"$FAKE_LOG"
status=installed; [[ -n \${FAKE_DPKG_FAILS:-} ]] && status=unpacked
for arg; do [[ $arg == *.deb ]] && echo "$(basename "$arg" | cut -d_ -f1) $status" >>"$FAKE_DATABASE"; done
[[ $status == installed ]]
`,
  // dpkg-query -W -f='\${db:Status-Status}' <package>
  'dpkg-query': `#!/usr/bin/env bash
package="\${*: -1}"
line="$(grep "^$package " "$FAKE_DATABASE" | tail -n 1)"
[[ -n $line ]] || { echo "dpkg-query: no packages found matching $package" >&2; exit 1; }
printf '%s' "\${line#* }"
`,
};

const MIRRORS = [
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
  'https://archive.ubuntu.com/ubuntu/\tpriority:2',
  'https://security.ubuntu.com/ubuntu/\tpriority:3',
];
const AZURE = 'http://azure.archive.ubuntu.com/ubuntu/';
const ARCHIVE = 'https://archive.ubuntu.com/ubuntu/';
const SECURITY = 'https://security.ubuntu.com/ubuntu/';

let folder = '';
let debs = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-e2e-packages-')));
  debs = path.join(folder, 'debs');
  mkdirSync(path.join(folder, 'bin'));
  for (const [name, text] of Object.entries(FAKES)) {
    writeFileSync(path.join(folder, 'bin', name), text);
    chmodSync(path.join(folder, 'bin', name), 0o755);
  }
  writeFileSync(path.join(folder, 'apt-mirrors.txt'), `${MIRRORS.join('\n')}\n`);
  writeFileSync(path.join(folder, 'log'), '');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

interface World {
  /** The packages the runner image has installed. */
  image?: string[];
  /** The packages whose `.deb` files the cache restored. */
  cached?: string[];
  /** The libraries the cached files need and neither they nor the image bring. */
  missing?: string[];
  /** The mirrors that answer too slowly to finish. */
  slow?: string[];
  dpkgFails?: boolean;
  /** Seconds per apt-get attempt, and for all of them. */
  attempt?: number;
  budget?: number;
}

function install(world: World = {}): SpawnSyncReturns<string> {
  writeFileSync(
    path.join(folder, 'database'),
    (world.image ?? ['xvfb', 'xauth']).map((name) => `${name} installed\n`).join(''),
  );
  mkdirSync(debs, { recursive: true });
  for (const name of world.cached ?? [])
    writeFileSync(path.join(debs, `${name}_1.0_amd64.deb`), '');
  return spawnSync('bash', [SCRIPT, debs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(folder, 'bin')}:${process.env['PATH'] ?? ''}`,
      APT_MIRROR_LIST: path.join(folder, 'apt-mirrors.txt'),
      APT_ATTEMPT_SECONDS: String(world.attempt ?? 10),
      APT_BUDGET_SECONDS: String(world.budget ?? 10),
      FAKE_LOG: path.join(folder, 'log'),
      FAKE_DATABASE: path.join(folder, 'database'),
      FAKE_MISSING: (world.missing ?? []).join(' '),
      FAKE_SLOW_MIRRORS: (world.slow ?? []).join(' '),
      FAKE_DPKG_FAILS: world.dpkgFails ? '1' : '',
    },
  });
}

/** Each call the fakes got: the command, and for apt-get the mirror first in the list. */
const calls = (): string[] =>
  readFileSync(path.join(folder, 'log'), 'utf8').trim().split('\n').filter(Boolean);

const installed = (): string[] => {
  const status = new Map<string, string>();
  for (const line of readFileSync(path.join(folder, 'database'), 'utf8').trim().split('\n')) {
    const [name = '', state = ''] = line.split(' ');
    status.set(name, state);
  }
  return [...status].filter(([, state]) => state === 'installed').map(([name]) => name);
};

const DOWNLOAD = `install --download-only ffmpeg pulseaudio xvfb xauth`;
const DPKG = 'dpkg\t--refuse-downgrade --skip-same-version --force-unsafe-io --install';

// CI runs this script on its Ubuntu runners only, with GNU coreutils' timeout.
describe.skipIf(process.platform !== 'linux')(
  'install-e2e-packages.sh',
  { timeout: PROCESS_BUDGET_MS },
  () => {
    it('installs the cached files with dpkg alone, never downgrading what the image has', () => {
      const result = install({ cached: ['ffmpeg', 'pulseaudio'] });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(calls()).toEqual([`${DPKG} ffmpeg_1.0_amd64.deb pulseaudio_1.0_amd64.deb`]);
      expect(installed()).toEqual(['xvfb', 'xauth', 'ffmpeg', 'pulseaudio']);
    });

    it('downloads the files into the folder first when it has none', () => {
      const result = install();

      expect(result.status).toBe(0);
      expect(calls()).toEqual([
        `apt-get\t${AZURE}\tupdate`,
        expect.stringMatching(new RegExp(`^apt-get\t${AZURE}\t.* ${DOWNLOAD}$`)),
        `${DPKG} ffmpeg_1.0_amd64.deb pulseaudio_1.0_amd64.deb`,
      ]);
      expect(readdirSync(debs).sort()).toEqual([
        'ffmpeg_1.0_amd64.deb',
        'pulseaudio_1.0_amd64.deb',
      ]);
    });

    // apt-get refuses --fix-broken beside a package name while dpkg has left packages unconfigured
    // ("Try 'apt --fix-broken install' with no packages"), so the two go one after the other.
    const FIX = ['install --fix-broken --download-only', 'install --fix-broken --no-download'];
    const XVFB = ['install --download-only xvfb', 'install --no-download xvfb'];

    it.each([
      [
        "the files lack a package this image does not ship (an older image's cache)",
        { image: ['xauth'], cached: ['ffmpeg', 'pulseaudio'] },
        [...FIX, ...XVFB],
        ['xvfb'],
      ],
      [
        'dpkg cannot finish (a library the image lacks)',
        { cached: ['ffmpeg', 'pulseaudio'], missing: ['libopus0'], dpkgFails: true },
        FIX,
        ['libopus0'],
      ],
      [
        'both',
        {
          image: ['xauth'],
          cached: ['ffmpeg', 'pulseaudio'],
          missing: ['libopus0'],
          dpkgFails: true,
        },
        [...FIX, ...XVFB],
        ['libopus0', 'xvfb'],
      ],
    ])(
      'lets apt-get download and install what is missing when %s',
      (_case, world, commands, added) => {
        const result = install(world);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('The cached files did not install everything');
        expect(calls().slice(1)).toEqual([
          `apt-get\t${AZURE}\tupdate`,
          ...commands.map((command) =>
            expect.stringMatching(new RegExp(`^apt-get\t${AZURE}\t.* ${command}$`)),
          ),
        ]);
        expect(installed()).toEqual(
          expect.arrayContaining(['ffmpeg', 'pulseaudio', 'xvfb', 'xauth']),
        );
        // The folder the workflow saves for this image now brings what was missing.
        expect(readdirSync(debs).sort()).toEqual(
          [...world.cached, ...added].map((name) => `${name}_1.0_amd64.deb`).sort(),
        );
      },
    );

    it("puts the image's next mirror first when one does not finish in time", () => {
      const result = install({ slow: [AZURE], attempt: 1 });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`apt-get did not finish within 1 s; next, ${ARCHIVE}`);
      expect(calls().map((call) => call.split('\t').slice(0, 2).join('\t'))).toEqual([
        `apt-get\t${AZURE}`,
        `apt-get\t${ARCHIVE}`,
        `apt-get\t${ARCHIVE}`,
        `${DPKG} ffmpeg_1.0_amd64.deb pulseaudio_1.0_amd64.deb`,
      ]);
      // The slow mirror stays last, for a file the others lack.
      expect(readFileSync(path.join(folder, 'apt-mirrors.txt'), 'utf8')).toBe(
        `${ARCHIVE}\tpriority:1\n${SECURITY}\tpriority:2\n${AZURE}\tpriority:3\n`,
      );
    });

    it('fails in its own words once no mirror finished within the whole budget', () => {
      const result = install({ slow: [AZURE, ARCHIVE, SECURITY], attempt: 1, budget: 2 });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "::error title=Ubuntu's mirrors are slow::apt-get did not download ffmpeg and PulseAudio within 2 s from any of the runner image's mirrors",
      );
      // Bash counts whole seconds, so the budget allows one attempt or two; nothing after them.
      expect(calls().every((call) => call.startsWith(`apt-get\t`))).toBe(true);
    });
  },
);
