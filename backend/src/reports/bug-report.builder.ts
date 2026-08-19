import type { StepResult } from '../common/test-plan.types';

/**
 * THE BUG REPORT.
 *
 * Turns a finding plus its evidence into the document a developer actually needs:
 * an id, an environment, numbered reproduction steps, expected vs actual, and
 * the evidence that proves it.
 *
 * One builder produces both Markdown (for pasting into Jira/Slack) and HTML
 * (which Playwright then prints to PDF), so the two can never disagree.
 */

export interface BugReportData {
  bugKey: string;
  title: string;
  status: string;
  severity?: string | null;
  priority?: string | null;
  module?: string | null;
  build?: string | null;
  classification?: string | null;
  aiClassification?: string | null;
  aiConfidence?: number | null;
  aiSummary?: string | null;
  aiSuspectedCause?: string | null;
  occurrences: number;
  createdAt: Date;
  lastSeenAt: Date;
  triagedBy?: string | null;
  assignee?: string | null;
  note?: string | null;

  requirement?: string | null;
  testCaseTitle: string;
  testCasePriority: string;

  environment: {
    url: string;
    runName: string;
    browser: string;
    browserVersion?: string | null;
    viewport?: string | null;
    finalUrl?: string | null;
  };

  failure: {
    errorType?: string | null;
    errorMessage?: string | null;
    expected?: string | null;
    actual?: string | null;
    failedStepLabel?: string | null;
    durationMs: number;
    attempt: number;
  };

  steps: StepResult[];
  consoleErrors: string[];
  apiErrors: string[];
  screenshotUrl?: string | null;
  traceUrl?: string | null;
  ticket?: { key: string; status: string; externalKey?: string | null; externalUrl?: string | null } | null;
}

/**
 * Reproduction steps, numbered, in the words a human would use.
 *
 * The recorded timeline is machine-shaped (`fill "Email"`), so it is translated
 * into instructions a developer can follow by hand - which is the whole point of
 * a repro section. Assertions become the "verify" line at the end.
 */
export function buildReproSteps(data: BugReportData): string[] {
  const out: string[] = [`Open ${data.environment.url}`];

  const actions = data.steps.filter((s) => s.index < 1000 && s.status !== 'skipped');
  for (const s of actions) {
    out.push(describeStep(s));
  }

  const failedAssertion = data.steps.find((s) => s.index >= 1000 && s.status === 'failed');
  if (failedAssertion) {
    out.push(`Observe the result — ${humanAssertion(failedAssertion.action)}`);
  }
  return out;
}

function describeStep(s: StepResult): string {
  const target = s.target ? `"${s.target}"` : '';
  switch (s.action) {
    case 'goto':
      return `Navigate to ${s.target}`;
    case 'click':
      return `Click ${target}`;
    case 'fill':
      return `Type into the ${target} field${valueHint(s.message)}`;
    case 'select':
      return `Choose an option in ${target}`;
    case 'check':
      return `Tick the ${target} checkbox`;
    case 'uncheck':
      return `Untick the ${target} checkbox`;
    case 'press':
      return `Press the ${s.target} key`;
    case 'hover':
      return `Hover over ${target}`;
    case 'waitForUrl':
      return `Wait for the URL to contain ${target}`;
    case 'waitForVisible':
      return `Wait for ${target} to appear`;
    default:
      return `${s.action} ${target}`.trim();
  }
}

/** Never leaks a secret: only says WHICH credential was used, not its value. */
function valueHint(message?: string): string {
  if (!message) return '';
  if (message.includes('test_email')) return ' (the test email)';
  if (message.includes('test_password')) return ' (the test password)';
  return '';
}

function humanAssertion(action: string): string {
  const type = action.replace('assert:', '');
  const map: Record<string, string> = {
    urlContains: 'the URL did not change as expected',
    urlNotContains: 'the URL still contains a value it should not',
    visible: 'the expected element is not visible',
    notVisible: 'an element that should be hidden is visible',
    textContains: 'the expected text is missing',
    textNotContains: 'text that should be gone is still present',
    valueEquals: 'the field does not hold the expected value',
    titleContains: 'the page title is wrong',
    elementCountAtLeast: 'fewer elements are present than expected',
    noConsoleErrors: 'the browser console reported an error',
    noApiErrors: 'an API request failed',
  };
  return map[type] ?? `the ${type} check failed`;
}

// ------------------------------------------------------------------ markdown

export function renderMarkdown(d: BugReportData): string {
  const L: string[] = [];
  const row = (k: string, v?: string | null) => (v ? `| ${k} | ${v} |` : null);

  L.push(`# ${d.bugKey} — ${d.title}`, '');

  L.push('| Field | Value |', '|---|---|');
  for (const line of [
    row('Status', d.status),
    row('Severity', d.severity?.replace('_', ' ')),
    row('Priority', d.priority),
    row('Module', d.module),
    row('Build', d.build),
    row('Classification', d.classification ?? d.aiClassification),
    row('Reproducibility', `${d.occurrences} occurrence(s)`),
    row('Reported', d.createdAt.toISOString()),
    row('Last seen', d.lastSeenAt.toISOString()),
    row('Triaged by', d.triagedBy),
    row('Assignee', d.assignee),
    row('Ticket', d.ticket ? `${d.ticket.key} (${d.ticket.status})` : null),
    row('External', d.ticket?.externalKey),
  ].filter(Boolean)) {
    L.push(line as string);
  }
  L.push('');

  L.push('## Environment', '');
  L.push(`- **URL:** ${d.environment.url}`);
  L.push(`- **Run:** ${d.environment.runName}`);
  L.push(
    `- **Browser:** ${d.environment.browser}${d.environment.browserVersion ? ` ${d.environment.browserVersion}` : ''}`,
  );
  if (d.environment.viewport) L.push(`- **Viewport:** ${d.environment.viewport}`);
  if (d.environment.finalUrl) L.push(`- **Ended on:** ${d.environment.finalUrl}`);
  L.push('');

  if (d.requirement) {
    L.push('## Requirement', '', `> ${d.requirement}`, '');
  }

  L.push('## Steps to reproduce', '');
  buildReproSteps(d).forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('');

  L.push('## Expected result', '', d.failure.expected || '(see requirement above)', '');
  L.push('## Actual result', '', d.failure.actual || d.failure.errorMessage || '(see below)', '');

  L.push('## Failure detail', '');
  L.push(`- **Error type:** ${d.failure.errorType ?? 'UNKNOWN'}`);
  if (d.failure.failedStepLabel) L.push(`- **Failed at:** ${d.failure.failedStepLabel}`);
  L.push(`- **Duration:** ${d.failure.durationMs}ms (attempt ${d.failure.attempt})`);
  if (d.failure.errorMessage) L.push('', '```', d.failure.errorMessage, '```');
  L.push('');

  if (d.consoleErrors.length) {
    L.push(`## Console errors (${d.consoleErrors.length})`, '', '```');
    d.consoleErrors.slice(0, 15).forEach((c) => L.push(c));
    L.push('```', '');
  }

  if (d.apiErrors.length) {
    L.push(`## Failed API requests (${d.apiErrors.length})`, '', '```');
    d.apiErrors.slice(0, 15).forEach((a) => L.push(a));
    L.push('```', '');
  }

  if (d.screenshotUrl || d.traceUrl) {
    L.push('## Evidence', '');
    if (d.screenshotUrl) {
      // An image embed, not just a link: Jira, GitHub and Slack all render this,
      // so whoever receives the report sees the failure without clicking.
      L.push(`![Screenshot at failure](${d.screenshotUrl})`, '');
      L.push(`[Open the screenshot](${d.screenshotUrl})`);
    }
    if (d.traceUrl) L.push(`[Playwright trace](${d.traceUrl}) — open at trace.playwright.dev`);
    L.push('');
  }

  if (d.aiSummary) {
    L.push('## AI analysis — suggestion only, not a verdict', '');
    L.push(
      `**${d.aiClassification}**${
        typeof d.aiConfidence === 'number' ? ` (${Math.round(d.aiConfidence * 100)}% confidence)` : ''
      }`,
      '',
    );
    L.push(d.aiSummary, '');
    if (d.aiSuspectedCause) L.push(`*Suspected cause:* ${d.aiSuspectedCause}`, '');
  }

  if (d.note) L.push('## QA notes', '', d.note, '');

  L.push('---', `Generated by AI Testing Platform · ${new Date().toISOString()}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------- html

/** Print-oriented HTML. Playwright turns this into the PDF. */
export function renderHtml(d: BugReportData): string {
  const esc = (s?: string | null) =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const chip = (label: string, value?: string | null, tone = 'neutral') =>
    value ? `<span class="chip ${tone}">${esc(label)}: <b>${esc(value)}</b></span>` : '';

  const kv = (k: string, v?: string | null) =>
    v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '';

  const block = (title: string, items: string[], cls = '') =>
    items.length
      ? `<h2>${esc(title)} <span class="count">${items.length}</span></h2>
         <pre class="log ${cls}">${items.slice(0, 20).map(esc).join('\n')}</pre>`
      : '';

  const severityTone =
    d.severity === 'S1_BLOCKER' ? 'bad' : d.severity === 'S2_MAJOR' ? 'warn' : 'neutral';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.bugKey)} — ${esc(d.title)}</title>
<style>
  /* SCREEN FIRST, PRINT SECOND.
     This document is read two ways: in a browser tab via "Open report", and
     printed to PDF by Chrome. It used to be styled only for A4 - mm units and
     @page - which is why it looked like a bare wall of text on screen. The
     screen rules are now the default and @media print restores the A4 layout. */

  :root {
    --ink: #0d1117;
    --dim: #5b6472;
    --faint: #939cab;
    --line: #e8eaf0;
    --panel: #f6f7f9;
    --card: #ffffff;
    --brand: #5b5bd6;
    --pass: #067647;
    --fail: #c01048;
    --warn: #b54708;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 32px 20px 64px;
    background: #f0f1f5;
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* A readable column. Full-bleed text across a 1900px monitor was the single
     worst thing about the old version. */
  .sheet {
    max-width: 880px;
    margin: 0 auto;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 40px 44px 36px;
    box-shadow: 0 1px 2px rgba(13, 17, 23, 0.04), 0 12px 32px -8px rgba(13, 17, 23, 0.08);
  }

  h1 {
    font-size: 25px;
    line-height: 1.25;
    letter-spacing: -0.022em;
    font-weight: 680;
    margin: 0 0 6px;
  }

  h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--faint);
    margin: 34px 0 10px;
    padding-bottom: 7px;
    border-bottom: 1px solid var(--line);
  }

  .sub { color: var(--dim); font-size: 14px; margin-bottom: 18px; }
  .sub a { color: var(--brand); }

  .chips { margin: 0 0 4px; display: flex; flex-wrap: wrap; gap: 7px; }
  .chip {
    display: inline-block;
    padding: 4px 11px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 550;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--dim);
  }
  .chip b { color: var(--ink); font-weight: 650; }
  .chip.bad { background: #fdeef1; border-color: #f7c4d0; color: var(--fail); }
  .chip.warn { background: #fef6e7; border-color: #f7dfae; color: var(--warn); }
  .chip.ok { background: #e7f7ee; border-color: #a9e0c1; color: var(--pass); }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td {
    text-align: left;
    padding: 9px 12px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  /* Constrained, not 50% of a wide screen — the old label column left a canyon
     of white space between the name and its value. */
  th { width: 150px; color: var(--faint); font-weight: 600; font-size: 13px; }
  tr:last-child th, tr:last-child td { border-bottom: none; }
  td { word-break: break-word; }

  ol { margin: 0; padding-left: 22px; }
  ol li { margin-bottom: 6px; }

  .compare { display: flex; gap: 14px; margin-top: 4px; }
  .compare > div {
    flex: 1;
    padding: 12px 15px;
    border-radius: 10px;
    background: var(--panel);
    font-size: 14px;
    word-break: break-word;
  }
  .compare .lbl {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--faint);
    font-weight: 700;
    margin-bottom: 4px;
  }
  .expected { border-left: 3px solid var(--pass); }
  .actual { border-left: 3px solid var(--fail); }

  pre.log {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 13px 15px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  pre.log.err { color: #b3261e; }

  .count {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 1px 8px;
    font-size: 11px;
    color: var(--dim);
    font-weight: 650;
    letter-spacing: 0;
    text-transform: none;
    margin-left: 6px;
  }

  .ai {
    background: #f3f6ff;
    border: 1px solid #d7e2fb;
    border-radius: 10px;
    padding: 15px 17px;
    font-size: 14px;
  }
  .ai p { margin: 0 0 8px; }
  .ai p:last-child { margin-bottom: 0; }
  .ai .warnlbl {
    color: var(--warn);
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }

  .shot { margin-top: 4px; }
  .shot img {
    max-width: 100%;
    display: block;
    border: 1px solid var(--line);
    border-radius: 10px;
  }

  footer {
    margin-top: 36px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    color: var(--faint);
    font-size: 12px;
  }

  @media (max-width: 620px) {
    body { padding: 14px 10px 40px; }
    .sheet { padding: 24px 20px; border-radius: 10px; }
    .compare { flex-direction: column; }
    th { width: auto; }
  }

  /* ------------------------------------------------------------ PRINT / PDF */
  /* Chrome prints this document to produce BUG-nnn.pdf, so A4 sizing lives here
     rather than in the base rules. */
  @media print {
    @page { size: A4; margin: 16mm 14mm; }
    body { padding: 0; background: #fff; font-size: 10.5pt; line-height: 1.5; }
    .sheet {
      max-width: none;
      margin: 0;
      padding: 0;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
    h1 { font-size: 19pt; }
    h2 { font-size: 9.5pt; margin: 6mm 0 2mm; }
    .sub { font-size: 9.5pt; margin-bottom: 4mm; }
    table, .compare > div, pre.log, .ai { font-size: 9pt; }
    pre.log { font-size: 8.5pt; }
    .chip { font-size: 8.5pt; padding: 1mm 2.5mm; }
    /* Keep a panel from being split across two pages. */
    .avoid-break { break-inside: avoid; }
    tr { break-inside: avoid; }
    h2 { break-after: avoid; }
    footer { margin-top: 8mm; font-size: 8pt; }
  }
</style></head><body>
<div class="sheet">

<h1>${esc(d.bugKey)} — ${esc(d.title)}</h1>
<div class="sub">${esc(d.environment.runName)} · ${esc(d.environment.url)}</div>

<div class="chips">
  ${chip('Status', d.status, d.status === 'CONFIRMED' ? 'bad' : 'neutral')}
  ${chip('Severity', d.severity?.replace('_', ' '), severityTone)}
  ${chip('Priority', d.priority)}
  ${chip('Module', d.module)}
  ${chip('Build', d.build)}
  ${chip('Seen', `${d.occurrences}x`)}
  ${d.ticket ? chip('Ticket', `${d.ticket.key} (${d.ticket.status})`, 'ok') : ''}
  ${d.ticket?.externalKey ? chip('Jira', d.ticket.externalKey, 'ok') : ''}
</div>

<h2>Summary</h2>
<table>
  ${kv('Test case', d.testCaseTitle)}
  ${kv('Requirement', d.requirement)}
  ${kv('Classification', d.classification ?? d.aiClassification)}
  ${kv('Reported', d.createdAt.toISOString())}
  ${kv('Last seen', d.lastSeenAt.toISOString())}
  ${kv('Triaged by', d.triagedBy)}
  ${kv('Assignee', d.assignee)}
</table>

<h2>Environment</h2>
<table>
  ${kv('URL', d.environment.url)}
  ${kv('Browser', `${d.environment.browser}${d.environment.browserVersion ? ' ' + d.environment.browserVersion : ''}`)}
  ${kv('Viewport', d.environment.viewport)}
  ${kv('Ended on', d.environment.finalUrl)}
  ${kv('Duration', `${d.failure.durationMs}ms (attempt ${d.failure.attempt})`)}
</table>

<h2>Steps to reproduce</h2>
<ol>${buildReproSteps(d).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

<h2>Expected vs actual</h2>
<div class="compare avoid-break">
  <div class="expected"><div class="lbl">Expected</div>${esc(d.failure.expected) || '(see requirement)'}</div>
  <div class="actual"><div class="lbl">Actual</div>${esc(d.failure.actual) || esc(d.failure.errorMessage) || '(see below)'}</div>
</div>

<h2>Failure detail</h2>
<table>
  ${kv('Error type', d.failure.errorType ?? 'UNKNOWN')}
  ${kv('Failed at', d.failure.failedStepLabel)}
</table>
${d.failure.errorMessage ? `<pre class="log err">${esc(d.failure.errorMessage)}</pre>` : ''}

${block('Console errors', d.consoleErrors, 'err')}
${block('Failed API requests', d.apiErrors, 'err')}

${
  d.aiSummary
    ? `<h2>AI analysis</h2>
       <div class="ai avoid-break">
         <div class="warnlbl">Suggestion only — a human decides</div>
         <p><b>${esc(d.aiClassification)}</b>${
           typeof d.aiConfidence === 'number' ? ` · ${Math.round(d.aiConfidence * 100)}% confidence` : ''
         }</p>
         <p>${esc(d.aiSummary)}</p>
         ${d.aiSuspectedCause ? `<p><i>Suspected cause:</i> ${esc(d.aiSuspectedCause)}</p>` : ''}
       </div>`
    : ''
}

${d.note ? `<h2>QA notes</h2><p>${esc(d.note)}</p>` : ''}

${
  d.screenshotUrl
    ? `<h2>Screenshot at failure</h2>
       <div class="shot avoid-break"><img src="${esc(d.screenshotUrl)}" alt="failure screenshot"></div>`
    : ''
}

<footer>
  ${esc(d.bugKey)} · Generated by AI Testing Platform · ${new Date().toISOString()}
  ${d.traceUrl ? `<br>Playwright trace available in the platform (open at trace.playwright.dev)` : ''}
</footer>
</div>
</body></html>`;
}
