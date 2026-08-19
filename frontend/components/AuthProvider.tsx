'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { canWrite, tokenStore, type AuthUser } from '../lib/auth';

/**
 * SESSION STATE FOR THE WHOLE APP.
 *
 * Responsibilities:
 *  1. restore the session on load (cached user first, then verify with /auth/me)
 *  2. redirect to /login when there is no session, and away from /login when
 *     there is one
 *  3. expose the current user, so components can hide actions a role cannot do
 *
 * A cached user is shown immediately so the UI does not flash an empty shell on
 * every page load; the server is still asked, and a rejection clears it.
 */

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  canWrite: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/register'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  // Give the api layer a way to bounce us out when a token is rejected.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUser(null);
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        router.replace('/login');
      }
    });
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const cached = tokenStore.cachedUser;
      if (cached) setUser(cached);

      if (!tokenStore.access) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const fresh = await api.getMe();
        if (!cancelled) setUser({ id: fresh.id, email: fresh.email, name: fresh.name, role: fresh.role });
      } catch {
        if (!cancelled) {
          tokenStore.clear();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Route guarding, once loading has settled so we never redirect prematurely.
  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath) router.replace('/login');
    if (user && isPublicPath) router.replace('/');
  }, [loading, user, isPublicPath, router]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      tokenStore.save(res.accessToken, res.refreshToken, res.user);
      setUser(res.user);
      router.replace('/');
    },
    [router],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api.register({ name, email, password });
      tokenStore.save(res.accessToken, res.refreshToken, res.user);
      setUser(res.user);
      router.replace('/');
    },
    [router],
  );

  const signOut = useCallback(async () => {
    // Revoke server-side first, but clear locally regardless: a failed network
    // call must never leave someone stuck logged in.
    await api.logout().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, canWrite: canWrite(user), signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
