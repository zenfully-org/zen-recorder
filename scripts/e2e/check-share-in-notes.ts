/**
 * Scenario 1's check of its notes: the remote participant's screen share is theirs where the
 * service's page shows who shares (Zoom, Teams), and where it does not (Meet) no row tells a share
 * by anyone else than the user, and the notes say shares were not observable there.
 */
import path from 'node:path';
import { waitForNotes } from './notes-files';
import type { FixtureTarget } from './targets';

export async function checkShareInNotes(webm: string, target: FixtureTarget): Promise<void> {
  const { document } = await waitForNotes(webm);
  const { participants, events, capture } = document;
  const sharers = events.flatMap((event) =>
    event.type === 'share-started' && event.by !== 'p1' ? [event.by] : [],
  );
  const named = sharers.map((id) => participants.find((person) => person.id === id)?.name ?? id);
  console.log(
    `  ${path.basename(webm)}: shares by ${JSON.stringify(named)}, ${capture.signals.share}`,
  );
  const expected = target.supports.shareBy ? [target.names.remote] : [];
  const observable = target.supports.shareBy ? 'observed' : 'not-available';
  if (JSON.stringify(named) !== JSON.stringify(expected) || capture.signals.share !== observable) {
    throw new Error(
      `the notes tell shares by ${JSON.stringify(named)} (${capture.signals.share}), not ${JSON.stringify(expected)} (${observable})`,
    );
  }
}
