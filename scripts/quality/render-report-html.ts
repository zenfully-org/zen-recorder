/**
 * Renders the quality report as one self-contained HTML page (`.quality/report.html`): plain HTML
 * and CSS, a few lines of script to sort a table by a column, nothing loaded from anywhere, so it
 * opens from disk with no network. Sections: the summary, the failures, how each metric spreads,
 * the 20 largest values per metric, the baseline with today's values, the clones, the import
 * rules, then every file with every function. The header says how report.json is shaped.
 */
import type { QualityReport, ReportFile, ReportFunction, WorstEntry } from './types';

/** Plain names for the measured metrics; any other is shown by its rule name. */
const LABELS: Record<string, string> = {
  'cognitive-complexity': 'Cognitive complexity',
  'cyclomatic-complexity': 'Cyclomatic complexity',
  'max-lines-per-function': 'Lines',
  'max-statements': 'Statements',
  'max-params': 'Parameters',
  'max-nested-callbacks': 'Callback depth',
  'max-lines': 'File lines',
};

const STYLE = `
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --line: #d1d9e0;
  --bad: #cf222e; --good: #1a7f37; --warn-bg: #fff8c5; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1;
  --line: #3d444d; --bad: #f85149; --good: #3fb950; --warn-bg: #3b2e00; } }
body { margin: 0 auto; max-width: 1200px; padding: 16px; font: 14px/1.5 system-ui, sans-serif;
  color: var(--fg); background: var(--bg); }
h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 32px; } h3 { font-size: 15px; }
table { border-collapse: collapse; margin: 8px 0 16px; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
th[data-sort] { cursor: pointer; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
td.over { background: var(--warn-bg); font-weight: 600; }
code { font: 13px ui-monospace, monospace; word-break: break-all; }
.muted { color: var(--muted); } .pass { color: var(--good); } .fail { color: var(--bad); }
details { margin: 4px 0; } summary { cursor: pointer; }
.wrap { overflow-x: auto; }
`;

const SCRIPT = `
document.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const table = th.closest('table'); const body = table.tBodies[0];
    const index = [...th.parentNode.children].indexOf(th);
    const down = th.dataset.dir !== 'down'; th.dataset.dir = down ? 'down' : 'up';
    const value = (row) => row.children[index].dataset.v ?? row.children[index].textContent;
    const rows = [...body.rows].sort((a, b) => {
      const x = value(a), y = value(b), nx = Number(x), ny = Number(y);
      const order = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
      return down ? -order : order;
    });
    body.append(...rows);
  });
});
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function label(metric: string): string {
  return escapeHtml(LABELS[metric] ?? metric);
}

function place(file: string, line: number | null): string {
  const where = line === null || line === 0 ? file : `${file}:${line}`;
  return `<code>${escapeHtml(where)}</code>`;
}

function listItem(text: string): string {
  return `<li>${text}</li>`;
}

function numberCell(value: number, threshold: number | null = null): string {
  const over = threshold !== null && value > threshold;
  return `<td class="n${over ? ' over' : ''}" data-v="${value}">${value}</td>`;
}

function table(head: string[], rows: string[], numeric: boolean[] = []): string {
  const cells = head.map(
    (text, i) => `<th data-sort${numeric[i] === true ? ' class="n"' : ''}>${text}</th>`,
  );
  return `<div class="wrap"><table><thead><tr>${cells.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderSummary(report: QualityReport): string {
  const s = report.summary;
  const verdict = report.passed
    ? '<strong class="pass">The gate passes.</strong>'
    : '<strong class="fail">The gate fails.</strong>';
  const counts = [
    `${s.files} files and ${s.functions} functions measured`,
    `${s.failures} failures`,
    `${s.newClones} new clones, ${s.staleClones} clones gone from the code but not from the baseline`,
    `${s.importViolations} broken import rules`,
    `${s.knownOffenders} known offenders in quality-baseline.json`,
    `${s.knownClones} known clones in .jscpd-baseline.json`,
  ];
  return `<p>${verdict} Generated ${escapeHtml(report.generatedAt)}.</p><ul>${counts.map(listItem).join('')}</ul>`;
}

function renderFailures(report: QualityReport): string {
  if (report.failures.length === 0) return '<p class="muted">None.</p>';
  const rows = report.failures.map(
    (f) =>
      `<tr><td>${place(f.file, f.line)}</td><td><code>${escapeHtml(f.key)}</code></td><td>${label(f.metric)}</td><td>${escapeHtml(f.kind)}</td><td class="n">${f.value ?? ''}</td><td class="n">${f.baseline ?? ''}</td><td class="n">${f.threshold ?? ''}</td></tr>`,
  );
  return table(['Place', 'Function', 'Metric', 'Kind', 'Value', 'Baseline', 'Threshold'], rows, [
    false,
    false,
    false,
    false,
    true,
    true,
    true,
  ]);
}

function renderDistributions(report: QualityReport): string {
  const rows = report.distributions.map(
    (d) =>
      `<tr><td>${label(d.metric)} <span class="muted">(${escapeHtml(d.metric)})</span></td>${numberCell(d.count)}${numberCell(d.p50)}${numberCell(d.p90)}${numberCell(d.max)}</tr>`,
  );
  return table(['Metric', 'Measured', 'Median', '90th percentile', 'Largest'], rows, [
    false,
    true,
    true,
    true,
    true,
  ]);
}

function worstRow(entry: WorstEntry): string {
  return `<tr><td>${place(entry.file, entry.line)}</td><td><code>${escapeHtml(entry.key)}</code></td>${numberCell(entry.value, entry.threshold)}<td class="n">${entry.threshold ?? ''}</td></tr>`;
}

function renderWorst(report: QualityReport): string {
  return report.worst
    .map(
      (w) =>
        `<h3>${label(w.metric)}</h3>${table(['Place', 'Function', 'Value', 'Threshold'], w.entries.map(worstRow), [false, false, true, true])}`,
    )
    .join('');
}

function renderBaseline(report: QualityReport): string {
  if (report.baseline.length === 0) return '<p class="muted">Empty.</p>';
  const rows = report.baseline.map(
    (b) =>
      `<tr><td>${place(b.file, null)}</td><td><code>${escapeHtml(b.key)}</code></td><td>${label(b.metric)}</td><td class="n">${b.baseline.join(', ')}</td><td class="n">${b.current.length === 0 ? '<span class="muted">gone</span>' : b.current.join(', ')}</td></tr>`,
  );
  return table(['File', 'Function', 'Metric', 'Baseline', 'Now'], rows, [
    false,
    false,
    false,
    true,
    true,
  ]);
}

function renderClones(report: QualityReport): string {
  if (report.clones.length === 0) return '<p class="muted">None.</p>';
  const rows = report.clones.map(
    (c) =>
      `<tr>${numberCell(c.lines)}<td>${place(c.first.file, c.first.line)}</td><td>${place(c.second.file, c.second.line)}</td><td>${c.isNew ? '<strong class="fail">new</strong>' : 'known'}</td></tr>`,
  );
  return table(['Lines', 'First', 'Second', 'Baseline'], rows, [true, false, false, false]);
}

function renderImports(report: QualityReport): string {
  if (report.importViolations.length === 0) {
    return '<p class="muted">None: no circular import, every local import resolves.</p>';
  }
  const rows = report.importViolations.map(
    (v) =>
      `<tr><td>${escapeHtml(v.rule)}</td><td><code>${escapeHtml([v.from, ...v.to].join(' → '))}</code></td></tr>`,
  );
  return table(['Rule', 'Chain'], rows);
}

function functionRow(fn: ReportFunction, file: ReportFile, metrics: string[]): string {
  const values = metrics.map((m) => numberCell(fn.metrics[m] ?? 0, file.thresholds[m] ?? null));
  return `<tr><td><code>${escapeHtml(fn.key)}</code></td>${numberCell(fn.line)}${values.join('')}</tr>`;
}

/** A file-level value with the threshold its file has, like "File lines 541 (threshold 400)". */
function fileValue(file: ReportFile, metric: string, value: number): string {
  const threshold = file.thresholds[metric];
  const limit = threshold === undefined ? '' : ` (threshold ${threshold})`;
  return `${label(metric)} ${value}${limit}`;
}

function renderFile(file: ReportFile, metrics: string[]): string {
  const head = ['Function', 'Line', ...metrics.map(label)];
  const rows = file.functions.map((fn) => functionRow(fn, file, metrics));
  const facts = [
    `${file.functions.length} functions`,
    ...Object.entries(file.metrics).map(([metric, value]) => fileValue(file, metric, value)),
  ];
  const thresholds = metrics
    .filter((m) => file.thresholds[m] !== undefined)
    .map((m) => `${label(m)} ${file.thresholds[m]}`)
    .join(', ');
  const summary = `<summary><code>${escapeHtml(file.file)}</code> <span class="muted">${facts.join(', ')}</span></summary>`;
  const limits = `<p class="muted">Thresholds: ${thresholds === '' ? 'none' : thresholds}.</p>`;
  return `<details>${summary}${limits}${table(head, rows, [false, ...head.slice(1).map(() => true)])}</details>`;
}

const SHAPE = `
<details><summary>How <code>report.json</code> is shaped (version 1)</summary>
<ul>
<li><code>version</code>: 1. A change of shape comes with a new version.</li>
<li><code>generatedAt</code>: when the report was written, ISO 8601. <code>passed</code>: whether the gate passed.</li>
<li><code>summary</code>: <code>files</code>, <code>functions</code>, <code>failures</code>, <code>newClones</code>, <code>staleClones</code>, <code>importViolations</code>, <code>knownOffenders</code>, <code>knownClones</code>.</li>
<li><code>functionMetrics</code>, <code>fileMetrics</code>: the metrics measured on every function and on every file, by their rule names.</li>
<li><code>distributions</code>: per metric, <code>count</code>, <code>p50</code>, <code>p90</code>, <code>max</code>.</li>
<li><code>worst</code>: per metric, the 20 largest <code>{ file, key, line, value, threshold }</code>.</li>
<li><code>files</code>: per file, <code>thresholds</code> (metric → threshold), <code>metrics</code> (file-level values) and <code>functions</code>: <code>{ key, line, metrics }</code>, where <code>key</code> is the chain of enclosing functions (<code>createPageSession &gt; handle</code>) the baseline uses.</li>
<li><code>failures</code>: what failed the gate, <code>{ kind, file, key, metric, value, baseline, threshold, line }</code>, <code>kind</code> being <code>new</code> or <code>worse</code>, and with <code>--strict</code> also <code>improved</code> or <code>stale</code> (otherwise slack, which passes).</li>
<li><code>baseline</code>: every entry of quality-baseline.json, <code>{ file, key, metric, baseline, current }</code>, with the values the code has now (empty when it is gone).</li>
<li><code>clones</code>: <code>{ lines, isNew, first: { file, line }, second: { file, line } }</code>. <code>importViolations</code>: <code>{ rule, from, to }</code>.</li>
</ul></details>`;

export function renderReportHtml(report: QualityReport): string {
  const metrics = report.functionMetrics;
  const files = report.files.map((file) => renderFile(file, metrics)).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quality report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Quality report</h1>
${renderSummary(report)}
<p class="muted">Written by <code>pnpm quality:report</code> next to <code>report.json</code>, which holds the same data. Click a column's header to sort by it.</p>
${SHAPE}
<h2>Failures</h2>
${renderFailures(report)}
<h2>How each metric spreads</h2>
${renderDistributions(report)}
<h2>Largest values</h2>
${renderWorst(report)}
<h2>Known offenders (quality-baseline.json)</h2>
${renderBaseline(report)}
<h2>Duplicated blocks</h2>
${renderClones(report)}
<h2>Import rules</h2>
${renderImports(report)}
<h2>Every file and function</h2>
<p class="muted">A value above the threshold of its file is highlighted.</p>
${files}
<script>${SCRIPT}</script>
</body>
</html>
`;
}
