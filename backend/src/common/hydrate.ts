import { unpackJson, unpackTags } from './db-json';
import type { PageSnapshot } from '../browser/browser.types';
import type { StepResult, TestAssertion, TestStep } from './test-plan.types';

/**
 * DATABASE ROW -> API RESPONSE.
 *
 * Turns the JSON-text columns back into real objects and arrays before anything
 * leaves the backend. The frontend therefore sees the same shapes it would with
 * PostgreSQL `jsonb`, and never has to know SQLite is underneath.
 *
 * Every controller response that includes a test case, result, finding or run
 * goes through one of these.
 */

type Row = Record<string, unknown>;

/**
 * steps / assertions / tags -> arrays.
 *
 * Each field is converted only when it is actually present, because several
 * endpoints select a slim test case (id + title + priority) and must not gain
 * phantom empty arrays.
 */
export function hydrateTestCase<T extends Row>(tc: T) {
  return {
    ...tc,
    ...('steps' in tc ? { steps: unpackJson<TestStep[]>(tc.steps as string, []) } : {}),
    ...('assertions' in tc
      ? { assertions: unpackJson<TestAssertion[]>(tc.assertions as string, []) }
      : {}),
    ...('tags' in tc ? { tags: unpackTags(tc.tags as string) } : {}),
    ...(Array.isArray(tc.results) ? { results: tc.results.map(hydrateResult) } : {}),
    ...(Array.isArray(tc.findings) ? { findings: tc.findings.map(hydrateFinding) } : {}),
  };
}

/** stepResults -> array. Also pre-splits logs when they were included. */
export function hydrateResult<T extends Row>(r: T) {
  const out: Row = {
    ...r,
    ...('stepResults' in r
      ? { stepResults: unpackJson<StepResult[]>(r.stepResults as string, []) }
      : {}),
  };

  if (r.testCase && typeof r.testCase === 'object') {
    out.testCase = hydrateTestCase(r.testCase as Row);
  }
  if (r.finding && typeof r.finding === 'object') {
    out.finding = hydrateFinding(r.finding as Row);
  }
  return out;
}

/** aiEvidence -> object, plus nested testCase / result. */
export function hydrateFinding<T extends Row>(f: T) {
  const out: Row = {
    ...f,
    aiEvidence: unpackJson<Record<string, unknown> | null>(f.aiEvidence as string, null),
  };

  if (f.testCase && typeof f.testCase === 'object') {
    out.testCase = hydrateTestCase(f.testCase as Row);
  }
  if (f.result && typeof f.result === 'object') {
    out.result = hydrateResult(f.result as Row);
  }
  return out;
}

/** payload -> object. */
export function hydrateRejection<T extends Row>(r: T) {
  return {
    ...r,
    payload: unpackJson<unknown>(r.payload as string, null),
  };
}

/** pageSnapshot -> object, plus every nested collection. */
export function hydrateRun<T extends Row>(run: T) {
  return {
    ...run,
    pageSnapshot: unpackJson<PageSnapshot | null>(run.pageSnapshot as string, null),
    ...(Array.isArray(run.testCases) ? { testCases: run.testCases.map(hydrateTestCase) } : {}),
    ...(Array.isArray(run.results) ? { results: run.results.map(hydrateResult) } : {}),
    ...(Array.isArray(run.findings) ? { findings: run.findings.map(hydrateFinding) } : {}),
    ...(Array.isArray(run.rejections) ? { rejections: run.rejections.map(hydrateRejection) } : {}),
  };
}
