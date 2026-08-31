import { z } from 'zod';

/**
 * The content pass: reading the page's own words and flagging wording problems.
 *
 * ADVISORY ONLY, and more strictly so than triage. A spell-check over real
 * product copy will confidently flag brand names, industry jargon, deliberate
 * lowercase styling and non-English strings. Those are not defects, and a tool
 * that reports them as bugs stops being trusted for the checks that matter.
 *
 * So this output never sets a status, never fails a test and never gets a BUG
 * id. It produces a review list.
 */

export const CONTENT_ISSUE_KINDS = [
  'TYPO', // misspelling: "Recieve", "Adress"
  'GRAMMAR', // broken sentence, wrong tense, missing article
  'LABEL', // label does not match the field it sits on
  'CASING', // inconsistent capitalisation between peers
  'PLACEHOLDER', // shipped scaffolding: "Lorem ipsum", "TODO", "test123"
  'INCONSISTENT', // same concept spelled two ways on one page
] as const;

export const contentIssueSchema = z.object({
  kind: z.enum(CONTENT_ISSUE_KINDS),
  /** Must be copied verbatim from the page so the reviewer can find it. */
  text: z.string().min(1).max(300),
  suggestion: z.string().max(300).optional(),
  reason: z.string().max(300).optional(),
  confidence: z.number().min(0).max(1),
  whereSeen: z.string().max(120).optional(),
});

export const contentCheckSchema = z.object({
  issues: z.array(contentIssueSchema).max(25).default([]),
});

export type ContentIssueResponse = z.infer<typeof contentIssueSchema>;
export type ContentCheckResponse = z.infer<typeof contentCheckSchema>;

export const CONTENT_CHECK_JSON_SCHEMA = {
  name: 'content_check',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['issues'],
    properties: {
      issues: {
        type: 'array',
        description:
          'Only genuine wording problems. An empty array is the correct answer for ' +
          'well-written copy, and is strongly preferred over a speculative list.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'text', 'confidence'],
          properties: {
            kind: { type: 'string', enum: [...CONTENT_ISSUE_KINDS] },
            text: {
              type: 'string',
              description: 'The exact string from the page, copied character for character.',
            },
            suggestion: { type: 'string', description: 'What it should say.' },
            reason: { type: 'string', description: 'One line: why this is wrong.' },
            confidence: {
              type: 'number',
              description:
                '0 to 1. Use below 0.6 whenever the word could be a brand, product name, ' +
                'or domain term you do not recognise.',
            },
            whereSeen: { type: 'string', description: 'heading / button / label / body' },
          },
        },
      },
    },
  },
} as const;
