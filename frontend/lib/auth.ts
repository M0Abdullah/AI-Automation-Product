'use client';

/**
 * TOKEN HANDLING.
 *
 * The access token lives in localStorage. That is a deliberate MVP tradeoff:
 * httpOnly cookies would be safer against XSS but need same-site cookie setup
 * across two ports, which is a distraction while proving the product. The
 * refresh token is rotated on every use and revoked on logout, so a leaked
 * access token expires within the hour.
 *
 * Swap this file for cookie-based auth before any public deployment.
 */

const ACCESS_KEY = 'aitest.accessToken';
const REFRESH_KEY = 'aitest.refreshToken';
const USER_KEY = 'aitest.user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'QA' | 'DEV' | 'VIEWER';
}

export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  get cachedUser(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  save(accessToken: string, refreshToken: string, user: AuthUser) {
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};

/** Can this role change test state? Mirrors WRITE_ROLES on the backend. */
export function canWrite(user: AuthUser | null): boolean {
  return user?.role === 'OWNER' || user?.role === 'QA';
}

export const ROLE_LABEL: Record<AuthUser['role'], string> = {
  OWNER: 'Owner',
  QA: 'QA engineer',
  DEV: 'Developer',
  VIEWER: 'Viewer',
};
