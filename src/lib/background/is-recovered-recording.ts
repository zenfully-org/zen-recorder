/**
 * Whether a recording's file is saved as recovered, with "(recovered)" in its name: its tab was
 * lost before it ended, so the end of the meeting may be missing. A recording still `recording` or
 * `interrupted` says so by its status. Once its save started it says so itself (`recovered`, which
 * the save stores first), because a save that fails leaves it `failed`, and one that stopped half
 * way leaves it `finalizing`. A recording stored before it did says nothing there: not recovered.
 */
import type { RecordingMeta } from '@/lib/types';

export function isRecoveredRecording(meta: RecordingMeta): boolean {
  return meta.status === 'recording' || meta.status === 'interrupted' || meta.recovered === true;
}
