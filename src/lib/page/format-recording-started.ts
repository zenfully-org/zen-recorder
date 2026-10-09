/** The Diagnostics line of a recording that started: its format, and its video's size and rate. */
export function formatRecordingStarted(
  mimeType: string,
  plan: { width: number; height: number; fps: number } | null,
): string {
  const video = plan ? `, video ${plan.width}x${plan.height}@${plan.fps}` : '';
  return `recording started (${mimeType}${video})`;
}
