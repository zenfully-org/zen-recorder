// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMeasurements } from './parse-measurements';

const measurement = {
  file: 'src/lib/a.ts',
  line: 3,
  key: 'createA',
  metric: 'cyclomatic-complexity',
  value: 4,
};

describe('parseMeasurements', () => {
  it('reads every measured value and the thresholds of each file', () => {
    const text = JSON.stringify({
      measurements: [measurement],
      thresholds: { 'src/lib/a.ts': { 'cyclomatic-complexity': 10 } },
    });
    expect(parseMeasurements(text)).toEqual({
      measurements: [measurement],
      thresholds: { 'src/lib/a.ts': { 'cyclomatic-complexity': 10 } },
    });
  });

  it('refuses output of another shape', () => {
    expect(() => parseMeasurements('{"measurements": [{"file": 1}]}')).toThrow(
      /measurements have an unexpected shape/,
    );
  });

  it('refuses output that is not JSON, such as an error message', () => {
    expect(() => parseMeasurements('Error: config not found')).toThrow(/measurements are not JSON/);
  });
});
