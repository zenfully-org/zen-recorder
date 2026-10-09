import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsEntry } from '@/lib/types';
import { copyDiagnostics } from './copy-diagnostics';

const ENTRIES: DiagnosticsEntry[] = [
  { at: Date.UTC(2026, 9, 8, 12, 0, 0), level: 'info', source: 'background', message: 'started' },
  { at: Date.UTC(2026, 9, 8, 12, 0, 1, 500), level: 'warn', source: 'page:3', message: 'no mic' },
];

describe('copyDiagnostics', () => {
  it('copies one tab-separated line per entry, in the log order, and resolves with null', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    await expect(copyDiagnostics({ load: async () => ENTRIES, writeText })).resolves.toBeNull();
    expect(writeText).toHaveBeenCalledWith(
      '2026-10-08T12:00:00.000Z\tinfo\tbackground\tstarted\n' +
        '2026-10-08T12:00:01.500Z\twarn\tpage:3\tno mic',
    );
  });

  it('copies a line that says so when the log is empty', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    await copyDiagnostics({ load: async () => [], writeText });
    expect(writeText).toHaveBeenCalledWith('(diagnostics log is empty)');
  });

  it('says why when the browser refuses the clipboard', async () => {
    const refusal = new DOMException(
      'Clipboard write was blocked due to lack of user activation.',
      'NotAllowedError',
    );
    const writeText = vi.fn(() => Promise.reject(refusal));
    await expect(copyDiagnostics({ load: async () => ENTRIES, writeText })).resolves.toBe(
      'Could not copy the diagnostics: Clipboard write was blocked due to lack of user activation.',
    );
  });

  it('says why when the log cannot be read, and copies nothing', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const load = () => Promise.reject(new Error('Could not establish connection.'));
    await expect(copyDiagnostics({ load, writeText })).resolves.toBe(
      'Could not copy the diagnostics: Could not establish connection.',
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says why when the failure is not an Error', async () => {
    const load = () => Promise.reject('busy');
    await expect(copyDiagnostics({ load, writeText: async () => undefined })).resolves.toBe(
      'Could not copy the diagnostics: busy',
    );
  });
});
