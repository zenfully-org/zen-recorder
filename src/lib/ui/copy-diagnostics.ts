/** The popup's Diagnostics button: the log, as text, on the clipboard. */
import type { DiagnosticsEntry } from '@/lib/types';

export interface CopyDiagnosticsDeps {
  /** The Diagnostics log from the background. */
  load: () => Promise<DiagnosticsEntry[]>;
  /**
   * `navigator.clipboard.writeText`. Firefox refuses it without the person's recent input (a
   * click less than 5 s ago) unless the extension has `clipboardWrite`, which it does not ask for.
   */
  writeText: (text: string) => Promise<void>;
}

/**
 * Copies the Diagnostics log, one tab-separated line per entry (time, level, source, message).
 * Resolves with what to tell the person when the log cannot be read or copied, the reason
 * included, or with `null` once it is on the clipboard.
 */
export function copyDiagnostics(deps: CopyDiagnosticsDeps): Promise<string | null> {
  return deps
    .load()
    .then((entries) =>
      deps.writeText(
        entries
          .map((e) => `${new Date(e.at).toISOString()}\t${e.level}\t${e.source}\t${e.message}`)
          .join('\n') || '(diagnostics log is empty)',
      ),
    )
    .then(
      () => null,
      (error: unknown) =>
        `Could not copy the diagnostics: ${error instanceof Error ? error.message : String(error)}`,
    );
}
