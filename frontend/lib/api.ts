import { tokenStore, type AuthUser } from './auth';
import type {
  CheckOption,
  DashboardOverview,
  Finding,
  FindingStatus,
  LoginSession,
  ResultDetail,
  RunDetail,
  RunListItem,
  TeamMember,
  TestCase,
  Ticket,
  TicketStatus,
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
  url: string;
  /** Optional now: ticked checks alone are a valid run. */
  requirements?: string;
  /** Ids from the check catalogue. */
  checks?: string[];
  name?: string;
  credentials?: { email?: string; password?: string };
  authorized: boolean;
  allowDestructive?: boolean;
}

export const createRun = (input: CreateRunInput) =>
  request<{ id: string }>('/runs', { method: 'POST', body: JSON.stringify(input) });

export const listRuns = () => request<RunListItem[]>('/runs');

export const getRun = (id: string) => request<RunDetail>(`/runs/${id}`);

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

// ----------------------------------------------------------------- tickets

export const createTicket = (
  findingId: string,
  body: {
    title?: string;
    priority?: string;
    severity?: string;
    module?: string;
    build?: string;
    assigneeId?: string;
    labels?: string;
  },
) =>
  request<Ticket>(`/findings/${findingId}/tickets`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const listTickets = (params?: { status?: TicketStatus; assigneeId?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.assigneeId) q.set('assigneeId', params.assigneeId);
  return request<Ticket[]>(`/tickets${q.toString() ? `?${q}` : ''}`);
};

export const getTicketStats = () => request<Record<TicketStatus, number>>('/tickets/stats');

export const getTicket = (id: string) => request<Ticket>(`/tickets/${id}`);

export const updateTicket = (
  id: string,
  body: Partial<{
    status: string;
    priority: string;
    severity: string;
    module: string;
    build: string;
    assigneeId: string;
    labels: string;
    title: string;
  }>,
) => request<Ticket>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const commentOnTicket = (id: string, body: string) =>
  request<Ticket>(`/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });

export const retestTicket = (id: string) =>
  request<{ retested: boolean; passed: boolean; suggestion: string }>(`/tickets/${id}/retest`, {
    method: 'POST',
  });

export const linkExternalTicket = (
  id: string,
  body: { externalKey: string; externalUrl: string; provider?: string },
) => request<Ticket>(`/tickets/${id}/external`, { method: 'POST', body: JSON.stringify(body) });

// ----------------------------------------------------------------- reports

export const reportUrl = (findingId: string, format: 'pdf' | 'markdown' | 'html') =>
  `${API_BASE}/findings/${findingId}/report/${format}`;

/**
 * Downloads the PDF through fetch so the Authorization header is sent, then
 * hands the blob to the browser. A plain anchor href cannot attach the token.
 */
export async function downloadReport(findingId: string, bugKey: string) {
  const res = await fetch(reportUrl(findingId, 'pdf'), {
    headers: { Authorization: `Bearer ${tokenStore.access ?? ''}` },
  });
  if (!res.ok) throw new ApiError(`Could not generate the PDF (${res.status})`, res.status);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bugKey}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Opens the HTML report in a new tab.
 *
 * It cannot be a plain <a href> — the report endpoint requires a bearer token,
 * and an anchor cannot send headers, so the tab would show a 401. So we fetch it
 * with the token and hand the browser a blob instead.
 *
 * The tab is opened BEFORE the await: browsers only allow window.open during a
 * user gesture, and awaiting first would lose that and get the popup blocked.
 */
export async function openReport(findingId: string) {
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.write(
      '<!doctype html><title>Loading report…</title>' +
        '<body style="font:15px system-ui;padding:40px;color:#5b6472">Building the report…</body>',
    );
  }

  try {
    const res = await fetch(reportUrl(findingId, 'html'), {
      headers: { Authorization: `Bearer ${tokenStore.access ?? ''}` },
    });
    if (!res.ok) throw new ApiError(`Could not build the report (${res.status})`, res.status);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (tab) {
      tab.location.replace(url);
    } else {
      // Popup blocked — fall back to the current tab rather than failing silently.
      window.location.assign(url);
    }

    // Revoked on a delay: revoking immediately can cancel the navigation before
    // the new tab has finished reading the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Fetches the markdown so it can be copied to the clipboard. */
export async function fetchReportMarkdown(findingId: string): Promise<string> {
  const res = await fetch(reportUrl(findingId, 'markdown'), {
    headers: { Authorization: `Bearer ${tokenStore.access ?? ''}` },
  });
  if (!res.ok) throw new ApiError(`Could not build the report (${res.status})`, res.status);
  return res.text();
}

// --------------------------------------------------------------- artifacts

/** Screenshots and traces are served by the backend, not Next.js. */
export const artifactUrl = (relativePath: string) =>
  `${API_BASE}/artifacts/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
