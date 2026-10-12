// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { listProjectFiles } from '../git-files';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { cruiseFiles } from './cruise-files';
import { runDependencyCruiser } from './run-dependency-cruiser';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const REPORT = z.object({ modules: z.array(z.object({ source: z.string() })) });

let root: string;
const savedGlobalConfig = process.env['GIT_CONFIG_GLOBAL'];

function write(file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

/** Two modules that import each other. */
function writeCycle(first: string, second: string): void {
  write(
    first,
    `import { y } from './${path.basename(second, path.extname(second))}';\nexport const x = y;\n`,
  );
  write(
    second,
    `import { x } from './${path.basename(first, path.extname(first))}';\nexport const y = x;\n`,
  );
}

/** The import check as the gate runs it, on what git lists, and the modules of dependency-cruiser's report. */
async function checkImports() {
  const reports: string[] = [];
  const violations = await runDependencyCruiser(
    {
      cruise: async (files) => {
        const report = await cruiseFiles(root, files);
        reports.push(report);
        return report;
      },
    },
    listProjectFiles(root, ['src', 'scripts']),
  );
  const read = reports.flatMap((report) => REPORT.parse(JSON.parse(report)).modules);
  return { violations, read: read.map((module) => module.source).sort() };
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'cruise-files-'));
  // The project's own rules and alias, so this checks them as the gate runs them.
  for (const file of [
    '.dependency-cruiser.cjs',
    'scripts/quality/dependency-cruiser-aliases.cjs',
  ]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(REPO, file), path.join(root, file));
  }
  // The developer's own global ignore rules must not decide what this test sees.
  write('gitconfig', '');
  process.env['GIT_CONFIG_GLOBAL'] = path.join(root, 'gitconfig');
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  write('.gitignore', '/src/scratch/\n');
  write('.git/info/exclude', '/src/excluded/\n');
  // A cycle through a type-only import and the `@` alias counts.
  write(
    'src/lib/a.ts',
    "import { b } from './b';\nexport type A = number;\nexport const a = (): A => b();\n",
  );
  write('src/lib/b.ts', "import type { A } from '@/lib/a';\nexport const b = (): A => 1;\n");
  write('src/lib/missing.ts', "import { gone } from '@/lib/nowhere';\nexport const m = gone;\n");
  write('src/lib/notes.md', '# Not code\n');
  writeCycle('src/test/fixtures/page.js', 'src/test/fixtures/other.js');
  writeCycle('src/components/ui/x.tsx', 'src/components/ui/y.tsx');
  // What an excluded file imports stays out too, so it must not be read at all.
  write(
    'src/components/ui/button.tsx',
    "import { cva } from 'class-variance-authority';\nexport const button = cva('');\n",
  );
  write('src/lib/gone.ts', 'export const gone = 1;\n');
  execFileSync('git', ['add', 'src'], { cwd: root, stdio: 'pipe' });
  // Deleted, not staged: git still tracks it, and dependency-cruiser fails on a file it cannot find.
  rmSync(path.join(root, 'src/lib/gone.ts'));
  writeCycle('scripts/new-x.ts', 'scripts/new-y.ts');
  writeCycle('src/scratch/c.ts', 'src/scratch/d.ts');
  write('src/scratch/build/background.js', 'export const built = 1;\n');
  writeCycle('src/excluded/e.ts', 'src/excluded/f.ts');
});

afterAll(() => {
  if (savedGlobalConfig === undefined) delete process.env['GIT_CONFIG_GLOBAL'];
  else process.env['GIT_CONFIG_GLOBAL'] = savedGlobalConfig;
  rmSync(root, { recursive: true, force: true });
});

// The listing starts git, and the cruise loads TypeScript.
describe('cruiseFiles', { timeout: PROCESS_BUDGET_MS }, () => {
  it('reports the cycles and unresolved imports of the files git tracks or would add', async () => {
    const { violations } = await checkImports();
    expect(violations).toEqual([
      {
        rule: 'no-circular',
        from: 'scripts/new-x.ts',
        to: ['scripts/new-y.ts', 'scripts/new-x.ts'],
      },
      { rule: 'no-circular', from: 'src/lib/a.ts', to: ['src/lib/b.ts', 'src/lib/a.ts'] },
      { rule: 'not-to-unresolvable', from: 'src/lib/missing.ts', to: ['@/lib/nowhere'] },
    ]);
  });

  it('leaves out every file git ignores, and the folders the configuration excludes', async () => {
    const { read } = await checkImports();
    expect(read).toEqual([
      '@/lib/nowhere',
      'scripts/new-x.ts',
      'scripts/new-y.ts',
      'scripts/quality/dependency-cruiser-aliases.cjs',
      'src/lib/a.ts',
      'src/lib/b.ts',
      'src/lib/missing.ts',
    ]);
  });

  it('leaves out an excluded file and a file it does not parse also when handed them', async () => {
    const report = await cruiseFiles(root, [
      'src/test/fixtures/page.js',
      'src/components/ui/x.tsx',
      'src/components/ui/button.tsx',
      'src/lib/notes.md',
    ]);
    expect(REPORT.parse(JSON.parse(report)).modules).toEqual([]);
  });
});
