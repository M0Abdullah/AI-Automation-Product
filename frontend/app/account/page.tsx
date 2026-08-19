'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../components/AuthProvider';
import { getLoginHistory, getTeam } from '../../lib/api';
import { ROLE_LABEL } from '../../lib/auth';
import type { LoginSession, TeamMember } from '../../lib/types';

/**
 * Account page: who you are, your login history, and the team.
 *
 * The login history exists because "who signed in, from where, and when" is a
 * question every tool with real accounts eventually has to answer.
 */
export default function AccountPage() {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getLoginHistory(), getTeam()])
      .then(([s, t]) => {
        setSessions(s);
        setTeam(t);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  if (!user) return null;

  return (
    <div className="stack">
      <div>
        <h1>Account</h1>
        <span className="faint">Your profile, sessions and team.</span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <dl className="detail-grid">
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>
              <span className="badge badge-brand">{ROLE_LABEL[user.role]}</span>
            </dd>
            <dt>Can edit</dt>
            <dd>
              {user.role === 'OWNER' || user.role === 'QA'
                ? 'Yes — approve tests, triage findings, manage tickets'
                : 'No — read only, plus comments'}
            </dd>
          </dl>
          <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Team</h2>
            <span className="faint">{team.length} member(s)</span>
          </div>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <div className="faint">{m.email}</div>
                    </td>
                    <td>{ROLE_LABEL[m.role]}</td>
                    <td className="faint">
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Login history</h2>
            <span className="faint">
              Every sign-in is recorded. A revoked session can no longer be refreshed.
            </span>
          </div>
        </div>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Signed in</th>
                <th>IP</th>
                <th>Device</th>
                <th>Expires</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="mono">{s.ipAddress ?? '—'}</td>
                  <td className="faint" style={{ maxWidth: 320 }}>
                    {s.userAgent ?? '—'}
                  </td>
                  <td className="faint">{new Date(s.expiresAt).toLocaleDateString()}</td>
                  <td>
                    {s.revokedAt ? (
                      <span className="badge badge-neutral">revoked</span>
                    ) : (
                      <span className="badge badge-pass">active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
