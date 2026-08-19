'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../../components/AuthProvider';
import type { ApiError } from '../../lib/api';

/**
 * Registration.
 *
 * The password rules are checked here as well as on the server — not for
 * security (the server is the authority), but so the user sees what is wrong
 * while typing instead of after a failed submit.
 */
export default function RegisterPage() {
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const rules = [
    { ok: password.length >= 8, label: 'At least 8 characters' },
    { ok: /[a-zA-Z]/.test(password), label: 'Contains a letter' },
    { ok: /[0-9]/.test(password), label: 'Contains a number' },
    { ok: confirm.length > 0 && password === confirm, label: 'Passwords match' },
  ];
  const ready = rules.every((r) => r.ok) && name.trim().length >= 2 && email.includes('@');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.message);
      if (Array.isArray(e2.details)) setDetails(e2.details as string[]);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-mark">AI</span>
          <span>Testing Platform</span>
        </div>

        <div className="auth-title">Create your account</div>
        <div className="auth-sub">
          Runs, findings and tickets are recorded against your name.
        </div>

        {error && (
          <div className="banner banner-error" style={{ marginBottom: 16 }}>
            <div>
              <strong>{error}</strong>
              {details.length > 0 && (
                <ul style={{ margin: '6px 0 0 16px' }}>
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">Full name</span>
          <input
            type="text"
            required
            autoFocus
            autoComplete="name"
            placeholder="Muhammad Abdullah"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Work email</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        <div className="stack-sm" style={{ marginBottom: 18 }}>
          {rules.map((r) => (
            <div
              key={r.label}
              className="row"
              style={{
                gap: 7,
                fontSize: 12.5,
                color: r.ok ? 'var(--pass)' : 'var(--text-faint)',
              }}
            >
              <span style={{ fontWeight: 700 }}>{r.ok ? '✓' : '○'}</span>
              {r.label}
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary btn-lg btn-block"
          type="submit"
          disabled={busy || !ready}
        >
          {busy ? (
            <>
              <span className="spinner" /> Creating account
            </>
          ) : (
            'Create account'
          )}
        </button>

        <div className="auth-foot">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
