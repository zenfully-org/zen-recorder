/** A failure with every field its tool did not say set to null, so the report's shape stays fixed. */
import type { StepFailure } from './types';

export function makeFailure(
  fields: Partial<StepFailure> & Pick<StepFailure, 'tool' | 'message'>,
): StepFailure {
  return {
    file: null,
    line: null,
    column: null,
    rule: null,
    test: null,
    scenario: null,
    provider: null,
    ...fields,
  };
}
