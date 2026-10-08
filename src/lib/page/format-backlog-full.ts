/**
 * The Diagnostics line for a recording that stops because the chunks the extension has not taken
 * fill the page's limit: how much waits, of that recording and of earlier ones, and what records
 * next. Sizes under 1 MiB are in KiB, so an audio backlog of a few seconds does not read as 0.0 MiB.
 */
import type { ChunkBacklog } from '@/lib/page/create-chunk-sender';

const formatBytes = (bytes: number): string =>
  bytes < 2 ** 20 ? `${Math.round(bytes / 2 ** 10)} KiB` : `${(bytes / 2 ** 20).toFixed(1)} MiB`;

export function formatBacklogFull(input: {
  recordingId: string;
  hasVideo: boolean;
  backlog: ChunkBacklog;
}): string {
  const { backlog } = input;
  const earlier = backlog.elsewhereBytes
    ? ` and ${formatBytes(backlog.elsewhereBytes)} of earlier recordings`
    : '';
  const next = input.hasVideo
    ? 'The video stops here; the rest of the meeting records audio only'
    : 'The recording stops here; the next one starts once the extension has taken them';
  return `backlog full: ${formatBytes(backlog.bytes)} of recording ${input.recordingId} (its last ${Math.round(backlog.spanMs / 1000)} s)${earlier} wait for the extension, more than the ${formatBytes(backlog.limitBytes)} the page holds. ${next}`;
}
