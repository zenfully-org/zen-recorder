import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderNotesJsonSchema } from './render-notes-json-schema';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('renderNotesJsonSchema', () => {
  // The published schema follows the format's zod schema: `pnpm notes:schema` writes it again.
  it('matches docs/meeting-notes.schema.json byte for byte', () => {
    const published = readFileSync(path.join(ROOT, 'docs/meeting-notes.schema.json'), 'utf8');
    expect(renderNotesJsonSchema()).toBe(published);
  });

  it('describes the 2020-12 draft, with the format schema id and version pattern', () => {
    const schema: unknown = JSON.parse(renderNotesJsonSchema());
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: {
        schema: { const: 'zen-recorder/meeting-notes' },
        schemaVersion: { pattern: '^1\\.\\d+$' },
      },
    });
  });
});
