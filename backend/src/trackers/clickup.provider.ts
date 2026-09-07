import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import {
  TrackerError,
  priorityToUrgency,
  standardLabels,
  type TrackerIssue,
  type TrackerIssueInput,
  type TrackerProvider,
} from './tracker.types';

export interface ClickUpConfig {
  /** Personal token (pk_…) or an OAuth access token. */
  apiToken: string;
  /** The numeric id of the List tasks are created in. */
  listId: string;
  /** Optional. A status name that must exist in that List, e.g. "to do". */
  status: string;
  timeoutMs: number;
}

const API = 'https://api.clickup.com/api/v2';

/**
 * CLICKUP (API v2).
 *
 * Three things differ from every other tracker here, and each one costs an
 * afternoon if you assume otherwise:
 *
 *  1. **No `Bearer`.** The Authorization header is the raw token. Prefixing it
 *     with `Bearer ` returns 401 with no explanation.
 *  2. **The List id is not in the URL you see.** Tasks are created against a
 *     numeric List id, which is the trailing number in a ClickUp list URL
 *     (app.clickup.com/…/li/`901234567`) — not the Space, Folder or task id.
 *  3. **`markdown_description`, not `description`.** `description` is stored as
 *     plain text, so a bug report sent there arrives with its `##` and `|`
 *     characters visible. Only the markdown field renders.
 */
export class ClickUpProvider implements TrackerProvider {
  readonly name = 'clickup' as const;
  private readonly logger = new Logger(ClickUpProvider.name);

  constructor(private readonly config: ClickUpConfig) {}

  describe(): string {
    return `ClickUp (list ${this.config.listId})`;
  }

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.apiToken) missing.push('CLICKUP_API_TOKEN');
    if (!this.config.listId) missing.push('CLICKUP_LIST_ID');
    return missing;
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    const me = await this.call<{ user?: { username?: string; email?: string } }>('GET', '/user');
    const list = await this.call<{ name?: string; id?: string; space?: { name?: string } }>(
      'GET',
      `/list/${encodeURIComponent(this.config.listId)}`,
    );
    return {
      ok: true,
      detail:
        `Connected as ${me.user?.username ?? me.user?.email ?? 'unknown user'}. ` +
        `List "${list.name ?? this.config.listId}"` +
        `${list.space?.name ? ` in space "${list.space.name}"` : ''} is reachable.`,
    };
  }

  async create(input: TrackerIssueInput): Promise<TrackerIssue> {
    const warnings: string[] = [];

    const body: Record<string, unknown> = {
      name: input.title.slice(0, 250),
      // The markdown field, so the report renders instead of arriving as
      // literal '##' and '|' characters.
      markdown_description: input.markdown,
      priority: priorityToUrgency(input.priority), // 1 urgent .. 4 low
      tags: standardLabels(input),
    };
    if (this.config.status) body.status = this.config.status;

    let task: { id: string; url?: string; custom_id?: string | null };
    try {
      task = await this.call<{ id: string; url?: string; custom_id?: string | null }>(
        'POST',
        `/list/${encodeURIComponent(this.config.listId)}/task`,
        body,
      );
    } catch (err) {
      // A status name that does not exist in the List is rejected outright.
      // Falling back to the List's default is better than failing to file.
      const statusProblem =
        err instanceof TrackerError && /status/i.test(err.message) && this.config.status;
      if (!statusProblem) throw err;

      this.logger.warn(
        `ClickUp rejected status "${this.config.status}"; retrying with the list default`,
      );
      warnings.push(
        `Status "${this.config.status}" does not exist in that List, so the task was created ` +
          'with the default status. Fix CLICKUP_STATUS.',
      );
      delete body.status;
      task = await this.call<{ id: string; url?: string }>(
        'POST',
        `/list/${encodeURIComponent(this.config.listId)}/task`,
        body,
      );
    }

    let uploaded = 0;
    for (const file of input.attachments) {
      try {
        await this.attach(task.id, file);
        uploaded++;
      } catch (err) {
        warnings.push(`Could not attach ${file.filename}: ${msg(err)}`);
      }
    }

    return {
      // custom_id is what a team using ClickUp's custom task ids actually says
      // out loud; the raw id is the fallback.
      key: task.custom_id || task.id,
      url: task.url ?? `https://app.clickup.com/t/${task.id}`,
      provider: this.name,
      attachmentsUploaded: uploaded,
      warnings,
    };
  }

  private async attach(
    taskId: string,
    file: { path: string; filename: string; contentType: string },
  ): Promise<void> {
    const bytes = await fs.promises.readFile(file.path);
    const form = new FormData();
    form.append(
      'attachment',
      new Blob([new Uint8Array(bytes)], { type: file.contentType }),
      file.filename,
    );

    const res = await fetch(`${API}/task/${encodeURIComponent(taskId)}/attachment`, {
      method: 'POST',
      // No Content-Type: fetch must set the multipart boundary itself.
      headers: { Authorization: this.config.apiToken, Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          // NOT `Bearer <token>` — ClickUp wants the bare token.
          Authorization: this.config.apiToken,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw new TrackerError(
        `Could not reach ClickUp: ${msg(err)}`,
        0,
        'Check that this machine can reach api.clickup.com (proxy, VPN, firewall).',
        this.name,
      );
    }

    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const detail = (await res.text()).slice(0, 600);
    throw new TrackerError(
      `ClickUp returned ${res.status}: ${detail}`,
      res.status,
      hint(res.status, this.config),
      this.name,
    );
  }
}

function hint(status: number, config: ClickUpConfig): string {
  switch (status) {
    case 400:
      return (
        'ClickUp refused the task. Usually a status name that does not exist in that List, ' +
        `or a required Custom Field. Check CLICKUP_STATUS${config.status ? ` ("${config.status}")` : ''}.`
      );
    case 401:
      return (
        'The token is wrong or expired. Get a personal token from ClickUp > Settings > Apps. ' +
        'Note that ClickUp wants the bare token in the Authorization header, with no "Bearer " prefix.'
      );
    case 403:
      return `That token cannot create tasks in list ${config.listId}. Check the workspace and the token's scope.`;
    case 404:
      return (
        `List ${config.listId} does not exist. CLICKUP_LIST_ID must be the numeric LIST id - the ` +
        'trailing number in a list URL like app.clickup.com/…/li/901234567 - not a Space, Folder or task id.'
      );
    case 429:
      return 'ClickUp is rate-limiting (100 requests/minute on most plans). Wait a minute and push again.';
    default:
      return 'See the ClickUp API v2 docs for this status code.';
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
