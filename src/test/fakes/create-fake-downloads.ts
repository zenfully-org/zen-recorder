/**
 * The downloads API as Firefox runs it for an extension, on a fake disk (Gecko's `ext-downloads.js`
 * and `DownloadCore.sys.mjs`):
 *   - `download()` picks the target before it resolves. With `uniquify` it moves to `base(1).ext`
 *     only when the target is already on disk, and creates that name at once. A new name reserves
 *     nothing, so two downloads asking for it at the same moment get the same target.
 *   - The download creates its target empty (the placeholder) `placeholderMs` after it started, and
 *     writes the data `writeMs` after it started.
 *   - Downloads that share a target at the same time break each other: the first to finish
 *     completes, every other one is interrupted, and an interrupted download removes its target
 *     from disk, the finished file included. Nothing with that name is left.
 *   - `search({ id })` reports the live state; `filename` is the absolute target. `search({ filename })`
 *     compares the absolute path without regard to case (`downloadQuery`).
 *   - Ids hold for one browser session. `restart()` starts the next one: a desktop Firefox keeps
 *     only unfinished downloads across a restart (`DownloadIntegration.shouldPersistDownload`) and
 *     numbers them again from 1 (`DownloadMap`, bug 1247794); the files stay on disk.
 *   - `show(id)` reveals the download's file and `showDefaultFolder()` the Downloads folder, both
 *     noted in `revealed`; `show` throws `Invalid download id N` for an id the session does not
 *     hold.
 *   - `download()` saves `%` as `_`, and refuses a name Firefox's own sanitizer would change
 *     (Linux rules: Windows also refuses its device names). It throws `filename must not contain
 *     illegal characters` and creates nothing.
 *   - A name above 250 UTF-8 bytes fails on ext4: its `.part` file passes the 255-byte limit, so
 *     the download is interrupted with `FILE_FAILED` and leaves nothing on disk.
 *   - `cancel(id)` interrupts an unfinished download with `USER_CANCELED` and removes what it
 *     wrote; a finished one is left alone, and an id the session does not hold is refused.
 */
import type { ShowSavedFileDeps } from '@/lib/background/show-saved-file';
import type { DownloadProgress, DownloadsDeps } from '@/lib/finalize/save-blob-to-downloads';

export interface FakeDownloadsOptions {
  /** The Downloads folder (default `/downloads`). */
  dir?: string;
  placeholderMs?: number;
  writeMs?: number;
}

export interface FakeDownloads {
  deps: DownloadsDeps;
  /** What showing a saved file calls: `search` by path, `show`, `showDefaultFolder`. */
  showDeps: ShowSavedFileDeps;
  /** What is on disk: absolute path → content (a placeholder is an empty Blob). */
  files: Map<string, Blob>;
  /** What `show` and `showDefaultFolder` revealed, in order: a file's path or the folder's. */
  revealed: string[];
  /** Object URLs not yet revoked. */
  liveUrls(): string[];
  /** The browser restarts: the next session lists the unfinished downloads only, from id 1. */
  restart(): void;
}

interface Clash {
  finished: boolean;
}

interface Item {
  target: string;
  state: DownloadProgress['state'];
  error?: DownloadProgress['error'];
  clash?: Clash;
}

/** `base.ext` → `base(1).ext`, `base(2).ext`… until the name is free (`createNiceUniqueFile`). */
function uniqueName(path: string, taken: (path: string) => boolean): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 1; ; n++) {
    const candidate = `${base}(${n})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Whether Gecko's `SanitizeFileName` would change this path component. */
function refusedByFirefox(component: string): boolean {
  return (
    // Replaced or dropped anywhere: path and Windows-illegal characters, controls, line and
    // paragraph separators, lone surrogates, format characters but U+180E, spaces but U+0020/U+3000.
    /[\\/:*?"<>|\p{Cc}\p{Zl}\p{Zp}\p{Cs}]|(?![ \u180E\u3000])[\p{Cf}\p{Zs}]/u.test(component) ||
    // Skipped at the start, trimmed at the end.
    /^[\p{Zs}.\u180E]|[ \u3000.\u180E]$/u.test(component) ||
    // A shortcut extension gets `.download` appended.
    /\.(?:lnk|local|url|scf|desktop)$/i.test(component)
  );
}

export function createFakeDownloads(options: FakeDownloadsOptions = {}): FakeDownloads {
  const dir = options.dir ?? '/downloads';
  const placeholderMs = options.placeholderMs ?? 5;
  const writeMs = options.writeMs ?? 50;
  const files = new Map<string, Blob>();
  const urls = new Map<string, Blob>();
  const items = new Map<number, Item>();
  let nextUrl = 0;
  let nextId = 1;

  const encoder = new TextEncoder();
  const tooLong = (target: string): boolean =>
    encoder.encode(`${target.slice(target.lastIndexOf('/') + 1)}.part`).length > 255;

  const start = (item: Item, blob: Blob): void => {
    const rivals = [...items.values()].filter(
      (other) => other !== item && other.state === 'in_progress' && other.target === item.target,
    );
    const [rival] = rivals;
    if (rival) {
      const clash = rival.clash ?? { finished: false };
      for (const member of [rival, item]) member.clash = clash;
    }
    setTimeout(() => {
      if (item.state === 'interrupted') return;
      if (tooLong(item.target)) {
        item.state = 'interrupted';
        item.error = 'FILE_FAILED';
        return;
      }
      if (!files.has(item.target)) files.set(item.target, new Blob([]));
    }, placeholderMs);
    setTimeout(() => {
      if (item.state === 'interrupted') return;
      if (item.clash?.finished) {
        item.state = 'interrupted';
        item.error = 'FILE_FAILED';
        files.delete(item.target);
        return;
      }
      if (item.clash) item.clash.finished = true;
      files.set(item.target, blob);
      item.state = 'complete';
    }, writeMs);
  };

  const revealed: string[] = [];
  const search = async (query: { id?: number; filename?: string }) =>
    [...items]
      .filter(
        ([id, item]) =>
          (query.id === undefined || id === query.id) &&
          (query.filename === undefined ||
            item.target.toLowerCase() === query.filename.toLowerCase()),
      )
      .map(([id, item]) => ({ id, state: item.state, filename: item.target, error: item.error }));

  const deps: DownloadsDeps = {
    async download({ url, filename, conflictAction }) {
      const blob = url === undefined ? undefined : urls.get(url);
      if (!blob) throw new Error(`fake downloads: unknown url ${String(url)}`);
      const name = (filename ?? '').replaceAll('%', '_');
      if (name.split('/').some(refusedByFirefox)) {
        throw new Error('filename must not contain illegal characters');
      }
      let target = `${dir}/${name}`;
      if (files.has(target) && conflictAction === 'uniquify') {
        target = uniqueName(target, (path) => files.has(path));
        files.set(target, new Blob([]));
      }
      const id = nextId++;
      const item: Item = { target, state: 'in_progress' };
      items.set(id, item);
      start(item, blob);
      return id;
    },
    search,
    createObjectURL(blob) {
      const url = `blob:fake/${nextUrl++}`;
      urls.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      urls.delete(url);
    },
    async cancel(id) {
      const item = items.get(id);
      if (!item) throw new Error(`Invalid download id ${id}`);
      if (item.state !== 'in_progress') return;
      item.state = 'interrupted';
      item.error = 'USER_CANCELED';
      files.delete(item.target);
    },
    setTimeout: (handler, ms) => setTimeout(handler, ms),
  };

  const showDeps: ShowSavedFileDeps = {
    search,
    async show(id) {
      const item = items.get(id);
      if (!item) throw new Error(`Invalid download id ${id}`);
      revealed.push(item.target);
      return true;
    },
    showDefaultFolder() {
      revealed.push(dir);
    },
  };

  return {
    deps,
    showDeps,
    files,
    revealed,
    liveUrls: () => [...urls.keys()],
    restart() {
      const unfinished = [...items.values()].filter((item) => item.state === 'in_progress');
      items.clear();
      nextId = 1;
      for (const item of unfinished) items.set(nextId++, item);
    },
  };
}
