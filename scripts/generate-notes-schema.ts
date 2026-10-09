/**
 * Writes docs/meeting-notes.schema.json, the JSON Schema of a meeting notes file's data block,
 * from the format's zod schema (src/lib/notes/parse-meeting-notes.ts). Run it after changing the
 * format: `pnpm notes:schema`. A test fails while the two differ.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderNotesJsonSchema } from './notes/render-notes-json-schema';

const target = path.resolve(import.meta.dirname, '../docs/meeting-notes.schema.json');
writeFileSync(target, renderNotesJsonSchema());
console.log(`wrote ${path.relative(process.cwd(), target)}`);
