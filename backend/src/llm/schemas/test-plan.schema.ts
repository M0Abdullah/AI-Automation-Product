import { z } from 'zod';
import { ALLOWED_ACTIONS, ALLOWED_ASSERTIONS } from '../../common/test-plan.types';

/**
 * The shape the LLM MUST return. This is validated before anything reaches the
 * policy engine, which is validated before anything reaches the browser.
 *
 * Two layers of defence:
 *   layer 1 (here)      - is it the right SHAPE?      -> zod
 *   layer 2 (policy)    - is it SAFE and ALLOWED?     -> PolicyService
 */

export const stepSchema = z.object({
  action: z.enum(ALLOWED_ACTIONS),
  target: z.string().min(1).max(300),
  valueRef: z.string().max(60).optional(),
  value: z.string().max(500).optional(),
  description: z.string().max(300).optional(),
});

export const assertionSchema = z.object({
  type: z.enum(ALLOWED_ASSERTIONS),
  target: z.string().max(300).optional(),
  value: z.string().max(500).optional(),
  description: z.string().max(300).optional(),
});

export const testCaseSchema = z.object({
  title: z.string().min(3).max(200),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  requirement: z.string().max(500).optional(),
  rationale: z.string().max(600).optional(),
  tags: z.array(z.string().max(40)).max(8).default([]),
  steps: z.array(stepSchema).min(1).max(40),
  assertions: z.array(assertionSchema).min(1).max(15),
  destructive: z.boolean().default(false),
});

export const testPlanSchema = z.object({
  testCases: z.array(testCaseSchema).min(1).max(30),
  /** Requirements the model could not test with the elements it was given. */
  untestable: z
    .array(
      z.object({
        requirement: z.string().max(500),
        reason: z.string().max(500),
      }),
    )
    .max(20)
    .default([]),
  /** Questions for the QA engineer - surfaced in the UI, not acted upon. */
  questions: z.array(z.string().max(300)).max(10).default([]),
});

export type TestPlanResponse = z.infer<typeof testPlanSchema>;

/**
 * JSON Schema handed to the model via response_format.
 * Kept hand-written (rather than generated) so the descriptions can teach the
 * model the rules - descriptions are the cheapest prompt engineering there is.
 */
export const TEST_PLAN_JSON_SCHEMA = {
  name: 'test_plan',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['testCases'],
    properties: {
      testCases: {
        type: 'array',
        description: 'One entry per test case you propose.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'priority', 'steps', 'assertions'],
          properties: {
            title: { type: 'string', description: 'Short QA-style title.' },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
            requirement: {
              type: 'string',
              description: 'The exact requirement line this case verifies.',
            },
            rationale: { type: 'string', description: 'One sentence: why this case matters.' },
            tags: { type: 'array', items: { type: 'string' } },
            destructive: {
              type: 'boolean',
              description: 'True if any step could change or destroy real data.',
            },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['action', 'target'],
                properties: {
                  action: { type: 'string', enum: [...ALLOWED_ACTIONS] },
                  target: {
                    type: 'string',
                    description:
                      'For fields: the exact label text from the page scan. ' +
                      'For clicks: the exact button or link text. ' +
                      'For goto: a path starting with /.',
                  },
                  valueRef: {
                    type: 'string',
                    enum: ['test_email', 'test_password'],
                    description:
                      'Use this instead of a real credential. Never write a password.',
                  },
                  value: {
                    type: 'string',
                    description: 'A literal non-secret value, e.g. a search term.',
                  },
                  description: { type: 'string' },
                },
              },
            },
            assertions: {
              type: 'array',
              description:
                'At least one. These decide PASS/FAIL. Only assert what the ' +
                'requirements actually state.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['type'],
                properties: {
                  type: { type: 'string', enum: [...ALLOWED_ASSERTIONS] },
                  target: { type: 'string' },
                  value: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
      untestable: {
        type: 'array',
        description: 'Requirements you could NOT test with the given page elements.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['requirement', 'reason'],
          properties: {
            requirement: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      questions: {
        type: 'array',
        description: 'Questions for the QA engineer about missing information.',
        items: { type: 'string' },
      },
    },
  },
} as const;
