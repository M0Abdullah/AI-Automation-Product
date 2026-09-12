import { tokenStore, type AuthUser } from './auth';
import type {
  CheckOption,
  ContentIssue,
  DesignIssue,
  DashboardOverview,
  Finding,
  FindingStatus,
  LoginSession,
  ResultDetail,
  RunDetail,
  RunListItem,
  RunPageDetail,
  IntegrationStatus,
  TeamMember,
  TestCase,
} from './types';

/**
 * The ONLY place the frontend talks to the backend.
 *
 * Note what is NOT here: no LLM key, no model name, no LLM call. The browser
 * never touches the LLM. It asks our backend, and our backend holds the secret.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export const POLL_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 2000);

/** Error shape the backend's exception filter always returns. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Called when the session is gone, so the app can bounce to /login. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit, retryOn401 = true): Promise<T> {
  const token = tokenStore.access;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      `Cannot reach the backend at ${API_BASE}. Is it running? (cd backend && npm run start:dev)`,
      0,
      'NETWORK',
    );
  }

  // An expired access token is the normal case after an hour of work, not an
  // error — refresh once and replay the request before bothering the user.
  if (res.status === 401 && retryOn401 && tokenStore.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
    tokenStore.clear();
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const b = body as { message?: string; code?: string; details?: unknown } | undefined;
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(
      b?.message ?? `Request failed (${res.status})`,
      res.status,
      b?.code,
      b?.details,
    );
  }

  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenStore.refresh }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    tokenStore.save(data.accessToken, data.refreshToken, data.user);
    return true;
  } catch {
    return false;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// ------------------------------------------------------------------ system

export const getHealth = () =>
  request<{
    ok: boolean;
    database: { ok: boolean; error?: string };
    llm: { provider: string; model: string; baseUrl: string; keyLoaded: boolean };
    browser: { headless: boolean; viewport: { width: number; height: number } };
  }>('/health');

export const getCapabilities = () =>
  request<{
    actions: string[];
    assertions: string[];
    valueRefs: string[];
    checks: CheckOption[];
  }>('/capabilities');

// -------------------------------------------------------------------- auth

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export const register = (body: { email: string; password: string; name: string }) =>
  request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const login = (body: { email: string; password: string }) =>
  request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const logout = () =>
  request<{ loggedOut: boolean }>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: tokenStore.refresh }),
  });

export const getMe = () => request<AuthUser & { lastLoginAt?: string }>('/auth/me');

export const getLoginHistory = () => request<LoginSession[]>('/auth/sessions');

export const getTeam = () => request<TeamMember[]>('/auth/users');

// --------------------------------------------------------------- dashboard

export const getDashboard = () => request<DashboardOverview>('/dashboard');

// -------------------------------------------------------------------- runs

export interface CreateRunInput {
  /**
   * The ENTRY url.
   *
   * With crawlEnabled it is the front door of the app and every other page is
   * discovered from it. Without, it is the one page under test. Either way it
   * is the only URL the user has to type.
   */
  url: string;
  /** Optional now: ticked checks alone are a valid run. */
  requirements?: string;
  /** Ids from the check catalogue. */
  checks?: string[];
  name?: string;
  credentials?: { email?: string; password?: string };
  /**
   * Sign-in page, for a target that sits behind a login. Given this plus
   * credentials, the backend signs in once before scanning and reuses that
   * session for every test. Must be on the same origin as `url`.
   */
  loginUrl?: string;
  /** Figma file key, or the whole Figma URL - the backend parses either. */
  figmaFileKey?: string;
  /** Figma node id ("18:0"), or the whole URL containing node-id=. */
  figmaNodeId?: string;
  /**
   * WHICH page the Figma frame describes. Defaults to `url`.
   *
   * The design comparison is single-page even on a whole-app run, because a
   * Figma frame IS one screen. This is how a run says "crawl everything, but
   * compare the design against /settings".
   */
  designPageUrl?: string;

  // ------------------------------------------------------------- whole app ---
  /**
   * TEST THE WHOLE APP rather than one URL.
   *
   * The backend follows same-origin links from `url`, then scans, plans and
   * runs tests against every page it finds - one run, one approval gate, one
   * findings list.
   */
  crawlEnabled?: boolean;
  /** Page budget. Each page costs a browser scan plus an LLM call. */
  maxPages?: number;
  /** Link depth from the entry URL. 1 = only what the entry page links to. */
  maxDepth?: number;
  /** Only crawl paths containing one of these. Empty = the whole origin. */
  includePaths?: string[];
  /** Skip paths containing one of these. Sign-out is always skipped anyway. */
  excludePaths?: string[];
  /** Explicit control labels, when the sign-in form cannot be auto-detected. */
  loginEmailField?: string;
  loginPassField?: string;
  loginSubmit?: string;
  authorized: boolean;
  allowDestructive?: boolean;
}

export const createRun = (input: CreateRunInput) =>
  request<{ id: string }>('/runs', { method: 'POST', body: JSON.stringify(input) });

export const listRuns = () => request<RunListItem[]>('/runs');

export const getRun = (id: string) => request<RunDetail>(`/runs/${id}`);

/**
 * One page of a run, with its snapshot and its advisory lists.
 *
 * Separate from getRun because a twelve-page run's snapshots are megabytes and
 * getRun is polled every couple of seconds while the run is in progress.
 */
export const getRunPage = (runId: string, pageId: string) =>
  request<RunPageDetail>(`/runs/${runId}/pages/${pageId}`);

/**
 * Review an advisory content issue.
 *
 * DISMISSED means "that is our brand name / jargon, stop showing me this" and is
 * stored server-side, so the same word does not come back on the next run.
 */
/**
 * Turn a confirmed wording problem into a real defect with a BUG id.
 *
 * Detection stays advisory; this is the human saying "yes, that is a bug". That
 * separation is what keeps the platform's no-false-bugs record intact.
 */
export const promoteContentIssue = (id: string, body?: { title?: string; severity?: string }) =>
  request<{ findingId: string; bugKey: string | null; alreadyExisted: boolean }>(
    `/content-issues/${id}/promote`,
    { method: 'POST', body: JSON.stringify(body ?? {}) },
  );

export const reviewDesignIssue = (id: string, status: 'NEW' | 'ACCEPTED' | 'DISMISSED') =>
  request<DesignIssue>(`/design-issues/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const promoteDesignIssue = (id: string, body?: { title?: string; severity?: string }) =>
  request<{ findingId: string; bugKey: string | null; alreadyExisted: boolean }>(
    `/design-issues/${id}/promote`,
    { method: 'POST', body: JSON.stringify(body ?? {}) },
  );

export const reviewContentIssue = (id: string, status: 'NEW' | 'ACCEPTED' | 'DISMISSED') =>
  request<ContentIssue>(`/content-issues/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const executeRun = (id: string) =>
  request<{ started: boolean; approvedCount: number }>(`/runs/${id}/execute`, { method: 'POST' });

export const replanRun = (id: string) =>
  request<{ started: boolean }>(`/runs/${id}/replan`, { method: 'POST' });

// -------------------------------------------------------------- test cases

export const updateTestCase = (id: string, patch: Partial<TestCase>) =>
  request<TestCase>(`/test-cases/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const approveTestCase = (id: string) =>
  request<TestCase>(`/test-cases/${id}/approve`, { method: 'POST' });

export const rejectTestCase = (id: string, reason?: string) =>
  request<TestCase>(`/test-cases/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const approveAllTestCases = (runId: string) =>
  request<{ approved: number }>(`/runs/${runId}/test-cases/approve-all`, { method: 'POST' });

export const retestTestCase = (id: string) =>
  request<{ retested: boolean }>(`/test-cases/${id}/retest`, { method: 'POST' });

// ----------------------------------------------------------------- results

export const getResult = (id: string) => request<ResultDetail>(`/results/${id}`);

// ---------------------------------------------------------------- findings

export const listFindings = (params?: { status?: FindingStatus; runId?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.runId) q.set('runId', params.runId);
  return request<Finding[]>(`/findings${q.toString() ? `?${q}` : ''}`);
};

export const getFindingStats = () => request<Record<FindingStatus, number>>('/findings/stats');

export const getFinding = (id: string) => request<Finding>(`/findings/${id}`);

export const triageFinding = (
  id: string,
  body: {
    decision: 'CONFIRM' | 'REJECT';
    classification: string;
    severity?: string;
    priority?: string;
    module?: string;
    build?: string;
    note?: string;
    assignee?: string;
    actor?: string;
  },
) => request<Finding>(`/findings/${id}/triage`, { method: 'POST', body: JSON.stringify(body) });

export const reopenFinding = (id: string, note?: string) =>
  request<Finding>(`/findings/${id}/reopen`, { method: 'POST', body: JSON.stringify({ note }) });

export const closeFinding = (id: string, note?: string) =>
  request<Finding>(`/findings/${id}/close`, { method: 'POST', body: JSON.stringify({ note }) });

export const commentOnFinding = (id: string, note: string) =>
  request<Finding>(`/findings/${id}/comments`, { method: 'POST', body: JSON.stringify({ note }) });

/** Everything this instance is wired up to. No secrets. */
export const getIntegrations = () => request<IntegrationStatus>('/integrations');

/** Checks the SMTP credentials. Does NOT send a test message. */
export const verifyMail = () =>
  request<{ ok: boolean; detail: string }>('/integrations/mail/verify', { method: 'POST' });

// --------------------------------------------------------------- artifacts

/** Screenshots and traces are served by the backend, not Next.js. */
export const artifactUrl = (relativePath: string) =>
  `${API_BASE}/artifacts/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
