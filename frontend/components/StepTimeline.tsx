import type { StepResult, TestAssertion, TestStep } from '../lib/types';

/**
 * Renders what the browser did, in order.
 *
 * Two modes:
 *  - plan mode (steps + assertions)     : what WILL happen, shown before approval
 *  - result mode (stepResults)          : what DID happen, with pass/fail marks
 */

const ICON = { passed: '✓', failed: '✕', skipped: '·' } as const;
const CLASS = { passed: 'step-pass', failed: 'step-fail', skipped: 'step-skip' } as const;

export function PlannedSteps({
  steps,
  assertions,
}: {
  steps: TestStep[];
  assertions: TestAssertion[];
}) {
  return (
    <div>
      <div className="faint" style={{ marginBottom: 4 }}>
        STEPS
      </div>
      {steps.map((s, i) => (
        <div className="step" key={`s${i}`}>
          <div className="step-icon step-skip">{i + 1}</div>
          <div className="step-body">
            <div className="step-title">
              {s.action} <strong>&quot;{s.target}&quot;</strong>
              {s.valueRef && <span className="pill" style={{ marginLeft: 6 }}>{s.valueRef}</span>}
              {s.value && !s.valueRef && (
                <span className="pill" style={{ marginLeft: 6 }}>
                  &quot;{s.value}&quot;
                </span>
              )}
            </div>
            {s.description && <div className="step-meta">{s.description}</div>}
          </div>
          <div />
        </div>
      ))}

      <div className="faint" style={{ margin: '10px 0 4px' }}>
        ASSERTIONS — these decide PASS or FAIL
      </div>
      {assertions.map((a, i) => (
        <div className="step" key={`a${i}`}>
          <div className="step-icon step-skip">?</div>
          <div className="step-body">
            <div className="step-title">
              {a.type}
              {a.target && (
                <>
                  {' '}
                  <strong>&quot;{a.target}&quot;</strong>
                </>
              )}
              {a.value && (
                <span className="pill" style={{ marginLeft: 6 }}>
                  {a.value}
                </span>
              )}
            </div>
            {a.description && <div className="step-meta">{a.description}</div>}
          </div>
          <div />
        </div>
      ))}
    </div>
  );
}

export function ExecutedSteps({ stepResults }: { stepResults: StepResult[] }) {
  if (!stepResults?.length) return <div className="faint">No step data recorded.</div>;

  // Assertions were stored with index >= 1000 so they sort after the actions.
  const actions = stepResults.filter((s) => s.index < 1000).sort((a, b) => a.index - b.index);
  const asserts = stepResults.filter((s) => s.index >= 1000).sort((a, b) => a.index - b.index);

  const render = (s: StepResult, label: string) => (
    <div className="step" key={`${label}-${s.index}`}>
      <div className={`step-icon ${CLASS[s.status]}`}>{ICON[s.status]}</div>
      <div className="step-body">
        <div className="step-title">
          {s.action}
          {s.target && (
            <>
              {' '}
              <strong>&quot;{s.target}&quot;</strong>
            </>
          )}
        </div>
        {(s.message || s.locatorStrategy) && (
          <div className="step-meta">
            {s.locatorStrategy && <>matched by {s.locatorStrategy}. </>}
            {s.message}
          </div>
        )}
      </div>
      <div className="step-time">{s.durationMs ? `${s.durationMs}ms` : ''}</div>
    </div>
  );

  return (
    <div>
      <div className="faint" style={{ marginBottom: 4 }}>
        WHAT THE BROWSER DID
      </div>
      {actions.map((s) => render(s, 'act'))}

      {asserts.length > 0 && (
        <>
          <div className="faint" style={{ margin: '10px 0 4px' }}>
            ASSERTIONS
          </div>
          {asserts.map((s) => render(s, 'asr'))}
        </>
      )}
    </div>
  );
}
