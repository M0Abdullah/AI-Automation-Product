/**
 * MARKDOWN -> ATLASSIAN DOCUMENT FORMAT.
 *
 * Jira Cloud's REST v3 `description` field is not a string — it is ADF, a
 * structured JSON document. Send it a plain string and the whole issue is
 * rejected with a 400 that names no field.
 *
 * WHY NOT REST v2, which does take a plain string: it still works on Jira
 * Cloud today, but Atlassian has deprecated it for exactly this endpoint, and
 * the bug report is the most valuable thing this integration carries. Building
 * on the endpoint that is on its way out would mean the tickets stop having
 * descriptions one day, with no warning.
 *
 * SCOPE, deliberately narrow: block-level constructs only — headings, bullet
 * lists, fenced code, tables as code, paragraphs — plus links inline. Anything
 * else degrades to plain text rather than risking invalid ADF, because a
 * slightly plain description is a far better failure than no issue at all.
 */

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Jira caps a description; well short of it, but a runaway log must not 400. */
const MAX_CHARS = 30_000;

export function markdownToAdf(markdown: string): AdfDocument {
  const source = markdown.length > MAX_CHARS ? `${markdown.slice(0, MAX_CHARS)}\n\n…truncated.` : markdown;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const content: AdfNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ------------------------------------------------------- fenced code
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence
      content.push(codeBlock(body.join('\n'), language));
      continue;
    }

    // ---------------------------------------------------------- heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1].length, 6) },
        content: inline(heading[2]),
      });
      i++;
      continue;
    }

    // ------------------------------------------------------------- rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      content.push({ type: 'rule' });
      i++;
      continue;
    }

    // ------------------------------------------------------- bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inline(lines[i].replace(/^\s*[-*+]\s+/, '')) }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // ------------------------------------------------------ ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) },
          ],
        });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    // -------------------------------------------------------------- table
    // Rendered as a code block rather than an ADF table. An ADF table needs
    // every row to declare matching cell counts, and a generated report's
    // tables are not guaranteed to be rectangular - one ragged row would
    // invalidate the entire document and lose the issue. Monospaced and
    // readable beats structured and rejected.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        // Drop the |---|---| separator row: it is markdown syntax, not data.
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim());
        i++;
      }
      content.push(codeBlock(rows.join('\n'), ''));
      continue;
    }

    // -------------------------------------------------------- blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // --------------------------------------------------------- paragraph
    const buffer: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      buffer.push(lines[i].trim());
      i++;
    }
    if (buffer.length) content.push({ type: 'paragraph', content: inline(buffer.join(' ')) });
  }

  // ADF rejects an empty doc, and a finding with no report body would produce
  // one. A placeholder paragraph keeps the issue creatable.
  if (!content.length) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: 'No description.' }] });
  }

  return { type: 'doc', version: 1, content };
}

/** ADF forbids an empty codeBlock, so a blank one gets a single space. */
function codeBlock(text: string, language: string): AdfNode {
  return {
    type: 'codeBlock',
    attrs: language ? { language } : {},
    content: [{ type: 'text', text: text.length ? text : ' ' }],
  };
}

/**
 * Inline formatting: links, code spans, bold and italics.
 *
 * Links are the one mark worth real effort — a bug report is full of
 * `/api/artifacts/…` screenshot URLs, and a report where the evidence is not
 * clickable has lost most of its usefulness inside a tracker.
 */
function inline(text: string): AdfNode[] {
  const out: AdfNode[] = [];
  // Markdown links, bare URLs, backtick code spans, **bold**, *italic*.
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>)]+)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text))) {
    if (m.index > last) push(out, text.slice(last, m.index));

    if (m[1] && m[2]) {
      out.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] } }] });
    } else if (m[3]) {
      out.push({ type: 'text', text: m[3], marks: [{ type: 'link', attrs: { href: m[3] } }] });
    } else if (m[4]) {
      out.push({ type: 'text', text: m[4], marks: [{ type: 'code' }] });
    } else if (m[5]) {
      out.push({ type: 'text', text: m[5], marks: [{ type: 'strong' }] });
    } else if (m[6]) {
      out.push({ type: 'text', text: m[6], marks: [{ type: 'em' }] });
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) push(out, text.slice(last));
  // A paragraph with no content is invalid ADF.
  return out.length ? out : [{ type: 'text', text: ' ' }];
}

/** ADF text nodes may not be empty strings. */
function push(out: AdfNode[], text: string): void {
  if (text.length) out.push({ type: 'text', text });
}
