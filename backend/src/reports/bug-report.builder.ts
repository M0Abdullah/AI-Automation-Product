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
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #16191d; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  h2 { font-size: 12pt; margin: 7mm 0 2mm; padding-bottom: 1mm;
       border-bottom: 1px solid #dfe3e8; }
  .sub { color: #5c6572; font-size: 10pt; margin-bottom: 4mm; }
  .chips { margin: 0 0 4mm; }
  .chip { display: inline-block; padding: 1mm 2.5mm; border-radius: 3mm; font-size: 8.5pt;
          background: #eef0f3; color: #16191d; margin: 0 1.5mm 1.5mm 0; }
  .chip.bad { background: #fdeaea; color: #c62828; }
  .chip.warn { background: #fdf3e0; color: #a86800; }
  .chip.ok { background: #e6f6ec; color: #17864b; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { text-align: left; padding: 1.6mm 2mm; border-bottom: 1px solid #eceef1;
           vertical-align: top; }
  th { width: 34mm; color: #5c6572; font-weight: 600; }
  ol { margin: 0; padding-left: 6mm; }
  ol li { margin-bottom: 1.2mm; }
  .compare { display: flex; gap: 4mm; margin-top: 2mm; }
  .compare > div { flex: 1; padding: 2.5mm 3mm; border-radius: 1.5mm; background: #f6f7f9; }
  .compare .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: .04em;
                  color: #8a93a0; margin-bottom: 1mm; }
  .expected { border-left: 1mm solid #17864b; }
  .actual { border-left: 1mm solid #c62828; }
  pre.log { background: #f6f7f9; border: 1px solid #e4e7eb; border-radius: 1.5mm;
            padding: 2.5mm 3mm; font: 8.5pt/1.45 ui-monospace, Consolas, monospace;
            white-space: pre-wrap; word-break: break-all; margin: 0; }
  pre.log.err { color: #b3261e; }
  .count { background: #eef0f3; border-radius: 3mm; padding: 0 2mm; font-size: 8.5pt;
           color: #5c6572; font-weight: 600; }
  .ai { background: #f3f6ff; border: 1px solid #d7e2fb; border-radius: 2mm;
        padding: 3mm; font-size: 9.5pt; }
  .ai .warnlbl { color: #a86800; font-weight: 700; font-size: 8.5pt;
                 text-transform: uppercase; letter-spacing: .04em; }
  .shot { margin-top: 2mm; }
  .shot img { max-width: 100%; border: 1px solid #dfe3e8; border-radius: 1.5mm; }
  footer { margin-top: 8mm; padding-top: 2mm; border-top: 1px solid #dfe3e8;
           color: #8a93a0; font-size: 8pt; }
  .avoid-break { break-inside: avoid; }
</style></head><body>

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
</body></html>`;
}
