import type { PageSnapshot } from '../lib/types';

/**
 * WHAT THE AI WAS ALLOWED TO SEE.
 *
 * Showing this is a deliberate transparency choice. When a generated locator is
 * wrong, this panel answers the immediate question - was the label missing from
 * the scan, or did the model ignore it?
 */
export function PageScanPanel({ snapshot }: { snapshot: PageSnapshot }) {
  const byKind = (kinds: string[]) => snapshot.elements.filter((e) => kinds.includes(e.kind));

  const fields = byKind(['input', 'textarea']);
  const buttons = byKind(['button']);
  const links = byKind(['link']);
  const selects = byKind(['select']);
  const toggles = byKind(['checkbox', 'radio']);

  return (
    <div className="stack">
      <div className="card card-tight">
        <div className="row">
          <span className="pill">HTTP {snapshot.httpStatus ?? '?'}</span>
          <span className="pill">{snapshot.durationMs}ms</span>
          <span className="pill">{snapshot.elements.length} elements</span>
          {snapshot.truncated && (
            <span className="badge badge-warn">
              truncated - raise SCAN_MAX_ELEMENTS to see more
            </span>
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>{snapshot.title}</strong>
        </div>
        <div className="faint mono" style={{ wordBreak: 'break-all' }}>
          {snapshot.finalUrl}
        </div>
        {snapshot.headings.length > 0 && (
          <div className="faint" style={{ marginTop: 4 }}>
            Headings: {snapshot.headings.join(' · ')}
          </div>
        )}
      </div>

      {(snapshot.consoleErrors.length > 0 || snapshot.failedRequests.length > 0) && (
        <div className="banner banner-warn">
          <div>
            <strong>The page already had problems before any test ran.</strong>
            {snapshot.consoleErrors.length > 0 && (
              <div className="mono" style={{ marginTop: 4 }}>
                {snapshot.consoleErrors.length} console error(s): {snapshot.consoleErrors[0]}
              </div>
            )}
            {snapshot.failedRequests.length > 0 && (
              <div className="mono" style={{ marginTop: 4 }}>
                {snapshot.failedRequests.length} failed request(s): {snapshot.failedRequests[0]}
              </div>
            )}
          </div>
        </div>
      )}

      <Group title="Input fields" rows={fields.map((f) => [f.label, `${f.type ?? 'text'}${f.required ? ' · required' : ''}${f.labelSource ? ` · label from ${f.labelSource}` : ''}`])} />
      <Group title="Buttons" rows={buttons.map((b) => [b.label, ''])} />
      <Group title="Selects" rows={selects.map((s) => [s.label, (s.options ?? []).join(', ')])} />
      <Group title="Checkboxes / radios" rows={toggles.map((t) => [t.label, t.kind])} />
      <Group title="Links" rows={links.map((l) => [l.label, l.href ?? ''])} />

      {snapshot.forms.length > 0 && (
        <Group
          title="Forms"
          rows={snapshot.forms.map((f) => [`${f.method} ${f.action}`, f.fields.join(', ')])}
        />
      )}

      {snapshot.visibleTextSample && (
        <details className="collapse">
          <summary>Visible text sample</summary>
          <div className="logbox">{snapshot.visibleTextSample}</div>
        </details>
      )}
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  if (!rows.length) return null;
  return (
    <div className="card card-tight">
      <div className="faint" style={{ marginBottom: 4 }}>
        {title.toUpperCase()} ({rows.length})
      </div>
      <div className="scroll-x">
        <table className="data">
          <tbody>
            {rows.map(([a, b], i) => (
              <tr key={`${a}-${i}`}>
                <td className="mono">
                  <strong>{a || '(no label)'}</strong>
                </td>
                <td className="faint" style={{ wordBreak: 'break-all' }}>
                  {b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
