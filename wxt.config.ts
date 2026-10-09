import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { createPrivateZodGlobalsPlugin } from './scripts/build/create-private-zod-globals-plugin';
import { writeLicenceNotices } from './scripts/notices/write-licence-notices';
import { createNoTestCodePlugin } from './scripts/release/create-no-test-code-plugin';
import { getGeckoSettings } from './scripts/release/get-gecko-settings';
import { listTrackedSources } from './scripts/zip/list-tracked-sources';
import { audioTapWorklet } from './src/lib/page/audio-tap-worklet';
import { getManifestPermissions } from './src/lib/project/get-manifest-permissions';
import { getProjectTexts } from './src/lib/project/get-project-texts';
import { getProviderCatalog } from './src/lib/providers/get-provider-catalog';

/**
 * `ZEN_RECORDER_E2E=1 wxt build` is the test build (`pnpm build:e2e`): it injects the content
 * scripts into the local fixture server too, and keeps the probes and faults the end-to-end run
 * drives, which a release build leaves out.
 */
const E2E = process.env['ZEN_RECORDER_E2E'] === '1';
const FIXTURE_MATCHES = ['http://localhost/*', 'http://127.0.0.1/*'];
/**
 * `ZEN_RECORDER_CHANNEL=self` builds the self-distributed XPI, which the release workflow signs on
 * addons.mozilla.org's unlisted channel and attaches to a GitHub Release; only that build names
 * the update manifest. A listed release is the build without it. `wxt zip` builds again before it
 * zips, so the variable must be set for `pnpm zip` too.
 */
const CHANNEL = process.env['ZEN_RECORDER_CHANNEL'];

export default defineConfig({
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!E2E) return;
      for (const script of manifest.content_scripts ?? []) {
        script.matches = [...(script.matches ?? []), ...FIXTURE_MATCHES];
      }
    },
    // The audio tap's worklet as a file of the extension: a meeting page whose policy refuses a
    // blob module (Teams') loads it from there. Written from the source the tap uses for its blob.
    'build:publicAssets': (_wxt, files) => {
      const { file, source } = audioTapWorklet();
      files.push({ contents: source, relativeDest: file });
    },
    // Every build ships the project's LICENSE and the notices of the packages it bundles (their
    // licences ask for that), and fails when one of them is under a licence the project may not
    // ship. Every chunk of every entrypoint group names the modules it holds. `wxt dev` is left
    // out: its build is never shipped, and it bundles WXT's reload client on top.
    'build:done': (wxt, output) => {
      if (wxt.config.command !== 'build') return;
      const files = writeLicenceNotices({
        root: wxt.config.root,
        outDir: wxt.config.outDir,
        moduleIds: output.steps.flatMap((step) =>
          step.chunks.flatMap((chunk) => (chunk.type === 'chunk' ? chunk.moduleIds : [])),
        ),
        project: { name: output.manifest.name, version: output.manifest.version },
      });
      output.publicAssets.push(...files.map((fileName) => ({ type: 'asset' as const, fileName })));
    },
    // The sources zip, for review on addons.mozilla.org, holds what git tracks (minus wxt's default
    // exclusions: tests, node_modules, the output folder, hidden files): an untracked file never
    // reaches it, whatever its name. Listed when zipping only, so a build needs no git.
    'zip:start': (wxt) => {
      wxt.config.zip.includeSources = listTrackedSources({
        cwd: wxt.config.zip.sourcesRoot,
        dot: wxt.config.zip.dotSources,
      });
    },
  },
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifestVersion: 3,
  // Explicit imports only (`#imports`) — keeps Biome's undeclared-variable rule useful.
  imports: false,
  // `wxt dev` opens no browser: the end-to-end run starts its own Firefox, and a build tried by
  // hand is loaded from about:debugging.
  webExt: { disabled: true },
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({
    plugins: [
      tailwindcss(),
      // zod's settings and global registry stay in each bundle instead of on globalThis, which
      // in a hook script is the meeting page's window (`scripts/build/rewrite-zod-globals.ts`).
      createPrivateZodGlobalsPlugin(),
      // A release build fails when it ships code of the test build's probes and faults
      // (`scripts/release/list-test-build-modules.ts`).
      ...(E2E ? [] : [createNoTestCodePlugin()]),
    ],
    // A constant in every build, which the bundler folds: the test build's probes and faults sit
    // behind `import.meta.env.WXT_E2E === '1'`, so a release build leaves them out.
    define: { 'import.meta.env.WXT_E2E': JSON.stringify(E2E ? '1' : '') },
  }),
  manifest: {
    // Written once with the independence notice; README.md and docs/store/listing.md quote them.
    name: getProjectTexts().name,
    description: getProjectTexts().description,
    // Each one is justified in docs/store/permissions.md, which its test keeps in step.
    permissions: [...getManifestPermissions()],
    host_permissions: getProviderCatalog().flatMap((provider) => provider.origins),
    // The meeting services' pages only (and the fixture's in a test build): the file's URL names
    // the extension's per-install id.
    web_accessible_resources: [
      {
        resources: [audioTapWorklet().file],
        matches: [
          ...getProviderCatalog().flatMap((provider) => provider.origins),
          ...(E2E ? FIXTURE_MATCHES : []),
        ],
      },
    ],
    browser_specific_settings: { gecko: getGeckoSettings(CHANNEL) },
    // Auto-grants host permissions for temporary installs (about:debugging, BiDi install). Ignored otherwise.
    granted_host_permissions: true,
    commands: {
      'toggle-recording': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Start or stop recording the current meeting',
      },
    },
  },
});
