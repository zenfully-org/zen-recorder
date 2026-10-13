// @vitest-environment node
/**
 * The end-to-end run prints `✓ <scenario> (<n> s)` after each scenario it passes. Read from the
 * logs of CI's end-to-end jobs, those lines give how long each scenario takes on each service:
 * the median of every run, so one slow runner does not move it.
 */
import { summarizeScenarioTimes } from './summarize-scenario-times';

/** A job's log line as GitHub writes it, with its time first. */
const line = (text: string) => `2026-10-12T22:08:35.2248769Z ${text}`;

describe('summarizeScenarioTimes', () => {
  it('takes the median of each scenario on each service', () => {
    const logs = [
      { provider: 'zoom', text: [line('  ✓ 10 (109 s)'), line('  ✓ routing (0 s)')].join('\n') },
      { provider: 'zoom', text: line('  ✓ 10 (111 s)') },
      { provider: 'zoom', text: line('  ✓ 10 (40 s)') },
      { provider: 'meet', text: line('  ✓ 10 (106 s)') },
    ];

    expect(summarizeScenarioTimes(logs)).toEqual({
      meet: { '10': 106 },
      zoom: { '10': 109, routing: 0 },
    });
  });

  it('rounds the median of an even count to whole seconds', () => {
    const logs = ['  ✓ 52 (93 s)', '  ✓ 52 (96 s)'].map((text) => ({ provider: 'teams', text }));

    expect(summarizeScenarioTimes(logs)).toEqual({ teams: { '52': 95 } });
  });

  it('reads only the lines of passed scenarios', () => {
    const text = [
      line('▶ meet scenario 5: extension reloaded mid-recording'),
      line('  [page] [zen-recorder] ✓ 5 (3 s) from a page'),
      line('✘ meet: scenario 9 (scenarioChunkNotStored) failed: timeout'),
      line('✔ Google Meet passed'),
      line('  ✓ scenario-name-with-dashes (12 s)'),
    ].join('\n');

    expect(summarizeScenarioTimes([{ provider: 'meet', text }])).toEqual({
      meet: { 'scenario-name-with-dashes': 12 },
    });
  });
});
