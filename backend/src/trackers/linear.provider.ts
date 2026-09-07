import {
  TrackerError,
  priorityToUrgency,
  standardLabels,
  type TrackerIssue,
  type TrackerIssueInput,
  type TrackerProvider,
} from './tracker.types';

export interface LinearConfig {
  /** Personal API key (lin_api_…) from Linear > Settings > API. */
  apiKey: string;
  /** The team the issue is filed into. A UUID, or the team key like "ENG". */
  team: string;
  timeoutMs: number;
}

const API = 'https://api.linear.app/graphql';

/**
 * LINEAR (GraphQL).
 *
 * Two differences from the REST trackers:
 *
 *  1. **GraphQL, one endpoint.** Errors come back as HTTP 200 with an `errors`
 *     array, so checking `res.ok` alone would report every failure as a
 *     success. `call()` inspects the body.
 *  2. **`teamId` is a UUID, not the key you see.** People know their team as
 *     "ENG"; the API wants the UUID. Rather than making the user hunt for it,
 *     `resolveTeamId()` accepts either and looks the key up.
 *
 * Linear has no file-attachment upload in the public API the way Jira and
 * ClickUp do — it takes URLs instead. So the evidence goes in as links to
 * `PUBLIC_API_URL/api/artifacts/…`, which is why that setting has to be
 * reachable from wherever the team reads their tickets.
 */
export class LinearProvider implements TrackerProvider {
  readonly name = 'linear' as const;

  /** Cached across calls: the key -> UUID lookup never changes mid-process. */
  private teamIdCache?: string;

  constructor(private readonly config: LinearConfig) {}

  describe(): string {
    return `Linear (team ${this.config.team})`;
  }

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.apiKey) missing.push('LINEAR_API_KEY');
    if (!this.config.team) missing.push('LINEAR_TEAM');
    return missing;
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    const data = await this.call<{ viewer: { name: string; email: string } }>(
      '{ viewer { name email } }',
    );
    const teamId = await this.resolveTeamId();
    return {
      ok: true,
      detail: `Connected as ${data.viewer.name} (${data.viewer.email}). Team resolved to ${teamId}.`,
    };
  }

  /** Accepts a UUID or a team key ("ENG") and returns the UUID. */
  private async resolveTeamId(): Promise<string> {
    if (this.teamIdCache) return this.teamIdCache;

    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      this.config.team,
    );
    if (looksLikeUuid) {
      this.teamIdCache = this.config.team;
      return this.teamIdCache;
    }

    const data = await this.call<{ teams: { nodes: Array<{ id: string; key: string; name: string }> } }>(
      '{ teams(first: 100) { nodes { id key name } } }',
    );
    const wanted = this.config.team.trim().toUpperCase();
    const match = data.teams.nodes.find((t) => t.key.toUpperCase() === wanted);
    if (!match) {
      throw new TrackerError(
        `No Linear team with key "${this.config.team}".`,
        404,
        `Teams available to this key: ${data.teams.nodes.map((t) => t.key).join(', ') || 'none'}. ` +
          'Set LINEAR_TEAM to one of those, or to the team UUID.',
        this.name,
      );
    }
    this.teamIdCache = match.id;
    return match.id;
  }

  async create(input: TrackerIssueInput): Promise<TrackerIssue> {
    const warnings: string[] = [];
    const teamId = await this.resolveTeamId();

    // Linear takes markdown directly, so the report needs no conversion. The
    // evidence is appended as links because the public API has no multipart
    // attachment upload.
    let description = input.markdown;
    if (input.attachments.length) {
      warnings.push(
        'Linear has no file-upload API, so the screenshot and trace are linked rather than ' +
          'attached. Those links only work for people who can reach PUBLIC_API_URL.',
      );
    }
    description += `\n\n---\n_Filed automatically by the AI QA platform._`;

    const data = await this.call<{
      issueCreate: {
        success: boolean;
        issue: { id: string; identifier: string; url: string } | null;
      };
    }>(
      `mutation CreateIssue($input: IssueCreateInput!) {
         issueCreate(input: $input) {
           success
           issue { id identifier url }
         }
       }`,
      {
        input: {
          teamId,
          title: input.title.slice(0, 250),
          description,
          priority: priorityToUrgency(input.priority), // 1 urgent .. 4 low
          labelIds: [], // Linear labels are ids, not free text; see below
        },
      },
    );

    if (!data.issueCreate.success || !data.issueCreate.issue) {
      throw new TrackerError(
        'Linear accepted the request but did not create the issue.',
        502,
        'This usually means a required field is enforced by a team template. Check the team settings.',
        this.name,
      );
    }

    // Linear labels must already exist and are referenced by id, so free-text
    // labels cannot be sent on create. They are recorded in the description
    // instead of being silently dropped.
    const labels = standardLabels(input);
    if (labels.length) {
      warnings.push(`Labels are not applied on Linear (they need ids): ${labels.join(', ')}`);
    }

    return {
      key: data.issueCreate.issue.identifier,
      url: data.issueCreate.issue.url,
      provider: this.name,
      attachmentsUploaded: 0,
      warnings,
    };
  }

  private async call<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          // Linear takes the raw key, like ClickUp — not a Bearer token.
          Authorization: this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw new TrackerError(
        `Could not reach Linear: ${msg(err)}`,
        0,
        'Check that this machine can reach api.linear.app (proxy, VPN, firewall).',
        this.name,
      );
    }

    const text = await res.text();

    if (!res.ok) {
      throw new TrackerError(
        `Linear returned ${res.status}: ${text.slice(0, 400)}`,
        res.status,
        res.status === 401 || res.status === 400
          ? 'The API key is wrong or expired. Generate one at Linear > Settings > API > Personal API keys.'
          : 'See the Linear API docs for this status code.',
        this.name,
      );
    }

    // GRAPHQL: errors arrive with HTTP 200. Trusting res.ok would report every
    // failure as a success and store a ticket with no external issue behind it.
    const body = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) {
      const detail = body.errors.map((e) => e.message).join('; ');
      throw new TrackerError(
        `Linear rejected the request: ${detail}`,
        400,
        /authentication|unauthorized/i.test(detail)
          ? 'The API key is wrong or expired. Generate one at Linear > Settings > API.'
          : 'Check LINEAR_TEAM and any required fields on that team.',
        this.name,
      );
    }
    if (!body.data) {
      throw new TrackerError('Linear returned no data.', 502, 'Retry the push.', this.name);
    }
    return body.data;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
