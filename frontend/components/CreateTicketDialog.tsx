'use client';

import { useEffect, useState } from 'react';
import { createTicket, getTeam } from '../lib/api';
import type { ApiError } from '../lib/api';
import type { Finding, TeamMember } from '../lib/types';

/**
 * CREATE A TICKET FROM A CONFIRMED BUG.
 *
 * Every field is prefilled from the finding, so the common path is: pick an
 * assignee, press create. The description is generated server-side as the full
 * bug report, which is why there is no description box here — retyping the
 * evidence is exactly the work this product exists to remove.
 */
export function CreateTicketDialog({
  finding,
  onCreated,
  onCancel,
}: {
  finding: Finding;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState(finding.priority ?? finding.testCase.priority ?? 'P2');
  const [severity, setSeverity] = useState(finding.severity ?? 'S2_MAJOR');
  const [module, setModule] = useState(finding.module ?? '');
  const [build, setBuild] = useState(finding.build ?? '');
  const [labels, setLabels] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeam()
      .then(setTeam)
      .catch(() => setTeam([]));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createTicket(finding.id, {
        assigneeId: assigneeId || undefined,
        priority,
        severity,
        module: module.trim() || undefined,
        build: build.trim() || undefined,
        labels: labels.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="card card-tight" style={{ background: 'var(--surface-2)', marginTop: 10 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <strong>Create ticket</strong>
        <span className="faint">
          The description is generated as the full bug report — nothing to retype.
        </span>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div className="grid-2">
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Assign to</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.role}
              </option>
            ))}
          </select>
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Priority — how soon</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="P0">P0 — fix now, blocks release</option>
            <option value="P1">P1 — this sprint</option>
            <option value="P2">P2 — normal</option>
            <option value="P3">P3 — whenever</option>
          </select>
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Severity — how bad</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="S1_BLOCKER">S1 — Blocker</option>
            <option value="S2_MAJOR">S2 — Major</option>
            <option value="S3_MINOR">S3 — Minor</option>
            <option value="S4_TRIVIAL">S4 — Trivial</option>
          </select>
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Module / feature</span>
          <input
            type="text"
            placeholder="Login page"
            value={module}
            onChange={(e) => setModule(e.target.value)}
          />
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Build / version</span>
          <input
            type="text"
            placeholder="staging-2026-08-19"
            value={build}
            onChange={(e) => setBuild(e.target.value)}
          />
        </label>

        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Labels</span>
          <input
            type="text"
            placeholder="frontend, auth"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
          />
        </label>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Create ticket
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
