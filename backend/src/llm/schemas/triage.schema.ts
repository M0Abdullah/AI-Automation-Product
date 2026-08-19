import { z } from 'zod';

/**
 * The second LLM call: explaining a failure.
 *
 * This output is ADVISORY ONLY. It never sets a status, never files a bug and
 * never closes anything. A human reads it and decides.
 */

export const CLASSIFICATIONS = [
  'PRODUCT_BUG',
  'TEST_DEFECT',
  'ENVIRONMENT_ISSUE',
  'TEST_DATA_ISSUE',
  'FLAKY',
  'UNKNOWN',
] as const;

export const triageSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(5).max(600),
  suspectedCause: z.string().max(800).optional(),
  /** Which pieces of evidence drove the conclusion. Keeps the AI honest. */
  evidenceUsed: z.array(z.string().max(200)).max(10).default([]),
  /** What a human should check next. */
  recommendedNextStep: z.string().max(400).optional(),
});

export type TriageResponse = z.infer<typeof triageSchema>;

export const TRIAGE_JSON_SCHEMA = {
  name: 'failure_triage',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['classification', 'confidence', 'summary'],
    properties: {
      classification: {
        type: 'string',
        enum: [...CLASSIFICATIONS],
        description:
          'PRODUCT_BUG only when the app clearly violated the stated requirement. ' +
          'TEST_DEFECT when the generated step or locator was wrong. ' +
          'ENVIRONMENT_ISSUE for outages, 5xx on every request, TLS or DNS errors. ' +
          'TEST_DATA_ISSUE for missing or already-consumed data. ' +
          'FLAKY when timing-dependent. UNKNOWN when the evidence is insufficient.',
      },
      confidence: { type: 'number', description: '0 to 1. Be honest; low is fine.' },
      summary: { type: 'string', description: 'One or two plain sentences for a QA engineer.' },
      suspectedCause: { type: 'string' },
      evidenceUsed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Quote the specific log lines or values you relied on.',
      },
      recommendedNextStep: { type: 'string' },
    },
  },
} as const;
