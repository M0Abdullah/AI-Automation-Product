/**
 * EMAIL TEMPLATES.
 *
 * One layout, four messages. Everything is inline-styled and table-based, which
 * looks like 2005 HTML and is not an accident: Gmail strips `<style>` blocks,
 * Outlook's renderer is Word, and neither supports flexbox or CSS variables. A
 * modern stylesheet here produces an unstyled wall of text in the two clients
 * that matter most.
 *
 * The palette matches the app's dark theme, but every message is built to stay
 * readable if the client blocks colours or images entirely — no information
 * lives in a colour alone, and there are no images at all.
 */

export interface Row {
  label: string;
  value: string;
  /** Colours the value. Never the ONLY signal — the label always says what it is. */
  tone?: 'pass' | 'fail' | 'warn';
}

/**
 * ONE FAILED TEST, spelled out in the email itself.
 *
 * The summary counts answer "is it broken". These answer "what broke and why",
 * which is the question that actually gets asked next — and answering it in the
 * inbox means the common case (glance at phone, decide if it can wait) needs no
 * login at all.
 */
export interface Failure {
  /** The test's name, e.g. "Login rejects a wrong password". */
  title: string;
  /** The page it ran against. */
  url?: string | null;
  /** WHY it failed, in the executor's words. Never the AI's opinion. */
  reason: string;
  /** Console errors and failed requests captured at the moment it broke. */
  evidence?: string[];
}

export interface LayoutInput {
  /** The grey line inboxes show next to the subject. Worth as much as the subject. */
  preheader: string;
  heading: string;
  intro: string;
  rows?: Row[];
  cta?: { label: string; url: string };
  /** Things the reader must not miss — rendered as a bordered warning block. */
  callouts?: string[];
  /** Per-failure detail, rendered under the counts. */
  failures?: Failure[];
  /** Heading above the failure list, e.g. "What failed". */
  failuresTitle?: string;
  footnote?: string;
}

const INK = '#e8e6f0';
const INK_DIM = '#a09ab8';
const BG = '#0a0910';
const SURFACE = '#151222';
const BORDER = '#2a2440';
const ACCENT = '#8b6cf0';
const PASS = '#4ade9b';
const FAIL = '#ff7a9a';
const WARN = '#f7c65a';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escapes text so a page title containing `<` cannot break the email. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toneColour(tone?: Row['tone']): string {
  if (tone === 'pass') return PASS;
  if (tone === 'fail') return FAIL;
  if (tone === 'warn') return WARN;
  return INK;
}

export function layout(input: LayoutInput): { html: string; text: string } {
  const rows = (input.rows ?? [])
    .map(
      (r) => `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid ${BORDER};color:${INK_DIM};font:14px ${FONT};white-space:nowrap;">${esc(r.label)}</td>
          <td style="padding:9px 0 9px 18px;border-bottom:1px solid ${BORDER};color:${toneColour(r.tone)};font:600 14px ${FONT};word-break:break-all;">${esc(r.value)}</td>
        </tr>`,
    )
    .join('');

  const callouts = (input.callouts ?? [])
    .map(
      (c) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
        <tr>
          <td style="padding:12px 14px;background:#241b2e;border-left:3px solid ${WARN};color:${INK};font:14px ${FONT};line-height:1.55;">${esc(c)}</td>
        </tr>
      </table>`,
    )
    .join('');

  // Each failure as its own bordered card: title, page, reason, then the raw
  // evidence in monospace. Capped at 10 — past that an email becomes a wall and
  // the link to the full results serves better.
  const shownFailures = (input.failures ?? []).slice(0, 10);
  const failures = shownFailures.length
    ? `
      <p style="margin:0 0 12px;color:${INK};font:700 15px ${FONT};">${esc(
        input.failuresTitle ?? 'What failed',
      )}</p>
      ${shownFailures
        .map(
          (f) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
          <tr>
            <td style="padding:13px 15px;background:#1d1526;border-left:3px solid ${FAIL};border-radius:0 6px 6px 0;">
              <div style="color:${INK};font:600 14px/1.5 ${FONT};">${esc(f.title)}</div>
              ${
                f.url
                  ? `<div style="margin-top:4px;color:${INK_DIM};font:12px ${FONT};word-break:break-all;">${esc(f.url)}</div>`
                  : ''
              }
              <div style="margin-top:8px;color:${FAIL};font:13px/1.55 ${FONT};">${esc(f.reason)}</div>
              ${
                f.evidence?.length
                  ? `<div style="margin-top:9px;padding-top:9px;border-top:1px solid ${BORDER};color:${INK_DIM};font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;">${f.evidence
                      .slice(0, 4)
                      .map((e) => esc(e))
                      .join('<br>')}</div>`
                  : ''
              }
            </td>
          </tr>
        </table>`,
        )
        .join('')}
      ${
        (input.failures?.length ?? 0) > shownFailures.length
          ? `<p style="margin:2px 0 0;color:${INK_DIM};font:13px ${FONT};">and ${
              (input.failures?.length ?? 0) - shownFailures.length
            } more — open the full results to see them all.</p>`
          : ''
      }`
    : '';

  const cta = input.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
        <tr>
          <td style="border-radius:8px;background:${ACCENT};">
            <a href="${esc(input.cta.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font:600 15px ${FONT};text-decoration:none;border-radius:8px;">${esc(input.cta.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:10px 0 0;color:${INK_DIM};font:12px ${FONT};word-break:break-all;">
        Or paste this link: ${esc(input.cta.url)}
      </p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <!-- Preheader: shown next to the subject in the inbox, hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:${SURFACE};border:1px solid ${BORDER};border-radius:14px;">
        <tr><td style="padding:26px 28px 0;">
          <div style="color:${ACCENT};font:700 13px ${FONT};letter-spacing:.12em;text-transform:uppercase;">AI QA Platform</div>
          <h1 style="margin:12px 0 0;color:${INK};font:700 23px/1.28 ${FONT};">${esc(input.heading)}</h1>
          <p style="margin:12px 0 0;color:${INK_DIM};font:15px/1.6 ${FONT};">${esc(input.intro)}</p>
        </td></tr>

        ${
          rows
            ? `<tr><td style="padding:20px 28px 0;">
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
               </td></tr>`
            : ''
        }

        ${callouts ? `<tr><td style="padding:20px 28px 0;">${callouts}</td></tr>` : ''}

        ${failures ? `<tr><td style="padding:22px 28px 0;">${failures}</td></tr>` : ''}

        ${cta ? `<tr><td style="padding:4px 28px 0;">${cta}</td></tr>` : ''}

        <tr><td style="padding:24px 28px 26px;">
          ${
            input.footnote
              ? `<p style="margin:0 0 14px;padding-top:16px;border-top:1px solid ${BORDER};color:${INK_DIM};font:13px/1.6 ${FONT};">${esc(input.footnote)}</p>`
              : ''
          }
          <p style="margin:0;color:#6b6484;font:12px/1.6 ${FONT};">
            Sent by your team's AI QA platform because you started this work or it was assigned to you.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // A real plain-text alternative, not a stripped copy of the HTML. Some
  // clients show it, and spam filters penalise HTML-only mail.
  const text = [
    input.heading,
    '='.repeat(Math.min(input.heading.length, 60)),
    '',
    input.intro,
    '',
    ...(input.rows ?? []).map((r) => `${r.label}: ${r.value}`),
    ...(input.callouts?.length ? ['', ...input.callouts.map((c) => `! ${c}`)] : []),
    ...(shownFailures.length
      ? [
          '',
          input.failuresTitle ?? 'What failed',
          '-'.repeat(30),
          ...shownFailures.flatMap((f) => [
            `* ${f.title}`,
            ...(f.url ? [`  page:   ${f.url}`] : []),
            `  reason: ${f.reason}`,
            ...(f.evidence ?? []).slice(0, 4).map((e) => `          ${e}`),
            '',
          ]),
        ]
      : []),
    ...(input.cta ? ['', `${input.cta.label}: ${input.cta.url}`] : []),
    ...(input.footnote ? ['', input.footnote] : []),
  ].join('\n');

  return { html, text };
}
