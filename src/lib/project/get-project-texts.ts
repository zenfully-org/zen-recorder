/**
 * How the project presents itself, written once: the manifest (`wxt.config.ts`) and the
 * Options page read these texts, and the test keeps `README.md` and `docs/store/listing.md` saying
 * the same words. No imports: `wxt.config.ts` loads this file without the "@" alias.
 */
export function getProjectTexts() {
  return {
    name: 'Zen Recorder',
    /** The manifest description, which AMO also takes as the listing's summary (250 characters). */
    description:
      'Records your Google Meet, Zoom and Microsoft Teams calls to files on your own disk, ready ' +
      'for an AI assistant to analyse. Nothing leaves your machine. Independent project, not ' +
      'affiliated with Zen Browser.',
    /** The independence notice, in the same words wherever the project presents itself. */
    notice:
      'Zen Recorder is an independent project. It is not affiliated with, endorsed by or ' +
      'sponsored by Zen Browser or its team. The maintainer uses Zen Browser, which is why the ' +
      'recorder targets Firefox-based browsers.',
  } as const;
}
