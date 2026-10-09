import { z } from 'zod';
import { meetingNotesSchema } from '../../src/lib/notes/parse-meeting-notes';

/** Where the schema is published: next to the format's documentation. */
const SCHEMA_ID =
  'https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes.schema.json';

/**
 * The JSON Schema of a notes file's data block, generated from the format's zod schema in input
 * mode: fields with a default stay optional, and unknown keys are allowed, as readers of 1.x
 * ignore them. `docs/meeting-notes.schema.json` holds it (`pnpm notes:schema`), and a test keeps
 * the two equal.
 */
export function renderNotesJsonSchema(): string {
  const generated = z.toJSONSchema(meetingNotesSchema, { io: 'input' });
  const schema = {
    ...generated,
    $id: SCHEMA_ID,
    title: 'zen-recorder meeting notes 1.0',
    description:
      'The JSON block under "## Data" in a zen-recorder meeting notes file. Documented in docs/meeting-notes-format.md.',
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}
