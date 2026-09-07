import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import { markdownToAdf } from './markdown-to-adf';
import {
  TrackerError,
  standardLabels,
  type TrackerIssue,
  type TrackerIssueInput,
  type TrackerProvider,
} from './tracker.types';

export interface JiraConfig {
  /** https://yourteam.atlassian.net — no trailing slash, no /rest path. */
  baseUrl: string;
  /** The Atlassian account email the API token belongs to. */
  email: string;
  apiToken: string;
  /** e.g. "QA". The project the issue is filed into. */
  projectKey: string;
  /** e.g. "Bug". Must exist in that project's scheme. */
  issueType: string;
  timeoutMs: number;
}

/**
 * JIRA CLOUD (REST v3).
 *
 * Auth is HTTP Basic with `email:api_token` — NOT the account password, which
 * Atlassian stopped accepting for the API. Tokens come from
 * id.atlassian.com/manage-profile/security/api-tokens.
 *
 * Two things about this API bite every first integration, and both are handled
 * here rather than left to the user to discover from a 400:
 *
 *  1. `description` must be ADF (structured JSON), not a string. See
 *     markdown-to-adf.ts for why v3 rather than the simpler v2.
 *  2. `priority` is NOT available in every project. Jira rejects the whole
 *     issue if you set a field the project's screen does not have, so a
 *     priority failure is retried once WITHOUT it — a filed ticket at default
 *     priority beats no ticket.
 */
export class JiraProvider implements TrackerProvider {
  readonly name = 'jira' as const;
  private readonly logger = new Logger(JiraProvider.name);

  constructor(private readonly config: JiraConfig) {}

  describe(): string {
    return `Jira (${this.host()}, project ${this.config.projectKey})`;
  }

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.baseUrl) missing.push('JIRA_BASE_URL');
    if (!this.config.email) missing.push('JIRA_EMAIL');
    if (!this.config.apiToken) missing.push('JIRA_API_TOKEN');
    if (!this.config.projectKey) missing.push('JIRA_PROJECT_KEY');
    return missing;
  }

  private host(): string {
    try {
      return new URL(this.config.baseUrl).host;
    } catch {
      return this.config.baseUrl;
    }
  }

  private authHeader(): string {
    const raw = `${this.config.email}:${this.config.apiToken}`;
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

  private base(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  /** Confirms the credentials AND that the project exists, without filing anything. */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    const me = await this.call<{ displayName?: string; emailAddress?: string }>(
      'GET',
      '/rest/api/3/myself',
    );
    const project = await this.call<{ name?: string; key?: string }>(
      'GET',
      `/rest/api/3/project/${encodeURIComponent(this.config.projectKey)}`,
    );
    return {
      ok: true,
      detail:
        `Connected to ${this.host()} as ${me.displayName ?? me.emailAddress ?? 'unknown user'}. ` +
        `Project ${project.key ?? this.config.projectKey} ("${project.name ?? '?'}") is reachable.`,
    };
  }

  async create(input: TrackerIssueInput): Promise<TrackerIssue> {
    const warnings: string[] = [];

    const fields: Record<string, unknown> = {
      project: { key: this.config.projectKey },
      summary: input.title.slice(0, 250), // Jira hard-caps the summary at 255
      description: markdownToAdf(input.markdown),
      issuetype: { name: this.config.issueType },
      labels: standardLabels(input),
    };

    const jiraPriority = mapPriority(input.priority);

    let created: { key: string; id: string };
    try {
      created = await this.call<{ key: string; id: string }>('POST', '/rest/api/3/issue', {
        fields: { ...fields, priority: { name: jiraPriority } },
      });
    } catch (err) {
      // A project without a priority field on its create screen rejects the
      // whole request. Retrying without it is the difference between a filed
      // bug and a support question.
      const isFieldProblem =
        err instanceof TrackerError && err.status === 400 && /priority/i.test(err.message);
      if (!isFieldProblem) throw err;

      this.logger.warn(
        `Jira rejected the priority field; retrying without it (project ${this.config.projectKey})`,
      );
      warnings.push(
        `Jira project ${this.config.projectKey} has no Priority field on its create screen, ` +
          `so the issue was filed at the project default instead of ${jiraPriority}.`,
      );
      created = await this.call<{ key: string; id: string }>('POST', '/rest/api/3/issue', {
        fields,
      });
    }

    // ------------------------------------------------------------ evidence
    let uploaded = 0;
    for (const file of input.attachments) {
      try {
        await this.attach(created.key, file);
        uploaded++;
      } catch (err) {
        // The issue exists. Losing it because a screenshot failed to upload
        // would be much worse than a ticket with a note about the screenshot.
        warnings.push(`Could not attach ${file.filename}: ${msg(err)}`);
      }
    }

    return {
      key: created.key,
      url: `${this.base()}/browse/${created.key}`,
      provider: this.name,
      attachmentsUploaded: uploaded,
      warnings,
    };
  }

  /**
   * Attachment upload. Two non-obvious requirements:
   *  - `X-Atlassian-Token: no-check` is mandatory, or Jira returns 403 XSRF.
   *  - Content-Type must NOT be set by hand; fetch derives the multipart
   *    boundary from the FormData, and overriding it breaks the parse.
   */
  private async attach(
    issueKey: string,
    file: { path: string; filename: string; contentType: string },
  ): Promise<void> {
    const bytes = await fs.promises.readFile(file.path);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: file.contentType }), file.filename);

    const res = await fetch(`${this.base()}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw new TrackerError(
        `Could not reach Jira at ${this.host()}: ${msg(err)}`,
        0,
        'Check JIRA_BASE_URL, and that this machine can reach Atlassian (proxy, VPN, firewall).',
        this.name,
      );
    }

    if (res.ok) {
      // 204 on some endpoints; JSON.parse('') would throw.
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const detail = (await res.text()).slice(0, 600);
    throw new TrackerError(`Jira returned ${res.status}: ${detail}`, res.status, hint(res.status, this.config), this.name);
  }
}

/** P0..P3 -> the names in Jira's default priority scheme. */
function mapPriority(priority?: string | null): string {
  switch ((priority ?? 'P2').toUpperCase()) {
    case 'P0':
      return 'Highest';
    case 'P1':
      return 'High';
    case 'P3':
      return 'Low';
    default:
      return 'Medium';
  }
}

/** What to actually DO about each status. */
function hint(status: number, config: JiraConfig): string {
  switch (status) {
    case 400:
      return (
        `Jira refused the issue's fields. The usual cause is that issue type ` +
        `"${config.issueType}" does not exist in project ${config.projectKey}, or the project ` +
        'requires a custom field on its create screen. Check JIRA_ISSUE_TYPE.'
      );
    case 401:
      return (
        'The API token is wrong or expired. Generate a new one at ' +
        'id.atlassian.com/manage-profile/security/api-tokens, and make sure JIRA_EMAIL is the ' +
        'account it belongs to — Jira rejects the account password for API calls.'
      );
    case 403:
      return `That account cannot create issues in project ${config.projectKey}. Ask an admin for the "Create Issues" permission.`;
    case 404:
      return `Project ${config.projectKey} does not exist, or JIRA_BASE_URL is wrong. It should look like https://yourteam.atlassian.net with no path.`;
    case 429:
      return 'Jira is rate-limiting. Wait a minute and push the ticket again.';
    default:
      return 'See the Jira Cloud REST API docs for this status code.';
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
