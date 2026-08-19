'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../../components/AuthProvider';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { ApiError } from '../../lib/api';

export default function LoginPage() {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="spread" style={{ marginBottom: 18 }}>
          <div className="auth-brand" style={{ marginBottom: 0 }}>
            <span className="brand-mark">AI</span>
            <span>Testing Platform</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="auth-title">Sign in</div>
        <div className="auth-sub">Your runs, findings and tickets are waiting.</div>

        {error && (
          <div className="banner banner-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <label className="field">
          <span className="field-label">Work email</span>
          <input
            type="email"
            required
            autoComplete="email"
            autoFocus
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
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" /> Signing in
            </>
          ) : (
            'Sign in'
          )}
        </button>

        <div className="auth-foot">
          No account yet? <Link href="/register">Create one</Link>
        </div>

        <div className="auth-side-note">
          The first account created on this instance becomes the owner.
        </div>
      </form>
    </div>
  );
}
