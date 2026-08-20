'use client';

import { RunForm } from '../../../components/RunForm';

/**
 * The new-run screen. Split out from the dashboard so the landing page can be an
 * overview rather than a form - a dashboard that is mostly one empty form does
 * not tell you anything about your test suite.
 */
export default function NewRunPage() {
  return (
    <div className="stack">
      <div className="page-hero">
        <span className="eyebrow">New test run</span>
        <h1>What should we test?</h1>
        <p className="page-subtitle">
          Add one authorised page. We&apos;ll inspect it, propose safe test cases, and wait for
          your approval before Chrome runs anything.
        </p>
      </div>
      <div className="composer-wrap">
        <RunForm />
      </div>
    </div>
  );
}
