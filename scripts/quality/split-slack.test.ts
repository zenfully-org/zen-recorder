// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitSlack } from './split-slack';
import type { Failure } from './types';

function of(kind: Failure['kind']): Failure {
  return {
    kind,
    file: 'src/lib/finalize/remux-webm.ts',
    key: 'remuxWebm',
    metric: 'cyclomatic-complexity',
    value: kind === 'stale' ? null : 11,
    baseline: kind === 'new' ? null : 12,
    threshold: 10,
    line: 20,
  };
}

const compared = {
  failures: [of('new'), of('worse'), of('improved'), of('stale')],
  staleClones: 2,
};

describe('splitSlack', () => {
  it('fails a new offender and a worse value, and lets an improved value, a stale entry and a gone clone pass as slack', () => {
    expect(splitSlack(compared, { strict: false })).toEqual({
      failures: [of('new'), of('worse')],
      staleClones: 0,
      slack: [of('improved'), of('stale')],
      goneClones: 2,
    });
  });

  it('fails all of them when strict, so the scheduled check finds a baseline that could be lowered', () => {
    expect(splitSlack(compared, { strict: true })).toEqual({
      ...compared,
      slack: [],
      goneClones: 0,
    });
  });
});
