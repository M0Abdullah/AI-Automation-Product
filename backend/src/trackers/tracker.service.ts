import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import { ClickUpProvider } from './clickup.provider';
import { JiraProvider } from './jira.provider';
import { LinearProvider } from './linear.provider';
import {
  TrackerError,
  type TrackerIssue,
  type TrackerIssueInput,
  type TrackerProvider,
  type TrackerProviderName,
} from './tracker.types';

/**
 * THE TRACKER FRONT DOOR.
 *
 * Picks the configured provider, builds the tracker-neutral payload, and turns
 * every failure into something a person can act on.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: file a ticket the moment a test fails.
 *
 * That is the obvious feature and it is the wrong one. A failing test has five
 * possible causes — a real bug, a wrong locator the AI wrote, a site outage, a
 * consumed test account, or flakiness — and only the first is a defect. A tool
 * that auto-files on failure spends its first week filling somebody's backlog
 * with its own mistakes, and after that nobody trusts anything it files.
 *
 * So the trigger is a HUMAN CONFIRMING the finding. After that, pushing to Jira
 * or ClickUp is automatic (`TRACKER_AUTO_PUSH=true`) and needs no further
 * clicks. The automation is real; the judgement stays with a person.
 */
@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  constructor(private readonly config: AppConfigService) {}

  /** The provider named by TRACKER_PROVIDER, or null when set to `none`. */
  private provider(): TrackerProvider | null {
    const t = this.config.tracker;
    switch (t.provider) {
      case 'jira':
        return new JiraProvider({
          baseUrl: t.jira.baseUrl,
          email: t.jira.email,
          apiToken: t.jira.apiToken,
          projectKey: t.jira.projectKey,
          issueType: t.jira.issueType,
          timeoutMs: t.timeoutMs,
        });
      case 'clickup':
        return new ClickUpProvider({
          apiToken: t.clickup.apiToken,
          listId: t.clickup.listId,
          status: t.clickup.status,
          timeoutMs: t.timeoutMs,
        });
      case 'linear':
        return new LinearProvider({
          apiKey: t.linear.apiKey,
          team: t.linear.team,
          timeoutMs: t.timeoutMs,
        });
      default:
        return null;
    }
  }

  /** Is a tracker set up at all? Drives whether the UI offers the button. */
  status(): {
    enabled: boolean;
    provider: TrackerProviderName | 'none';
    describe: string;
    autoPush: boolean;
    missingConfig: string[];
  } {
    const p = this.provider();
    if (!p) {
      return {
        enabled: false,
        provider: 'none',
        describe: 'No issue tracker configured',
        autoPush: false,
        missingConfig: ['TRACKER_PROVIDER'],
      };
    }
    const missing = p.missingConfig();
    return {
      enabled: missing.length === 0,
      provider: p.name,
      describe: p.describe(),
      autoPush: this.config.tracker.autoPush && missing.length === 0,
      missingConfig: missing,
    };
  }

  /** True when a push would actually be attempted. */
  get autoPushEnabled(): boolean {
    return this.status().autoPush;
  }

  /**
   * Check the credentials without filing anything.
   *
   * Separate from `create` on purpose: a "Test connection" button that worked
   * by filing a throwaway issue into a real backlog would be worse than having
   * no button.
   */
  async verify(): Promise<{ ok: boolean; provider: string; detail: string }> {
    const p = this.provider();
    if (!p) {
      return {
        ok: false,
        provider: 'none',
        detail: 'TRACKER_PROVIDER is not set. Use jira, clickup or linear.',
      };
    }
    const missing = p.missingConfig();
    if (missing.length) {
      return {
        ok: false,
        provider: p.name,
        detail: `Missing configuration: ${missing.join(', ')}. Add them to backend/.env.`,
      };
    }
    try {
      const res = await p.verify();
      return { ok: res.ok, provider: p.name, detail: res.detail };
    } catch (err) {
      return { ok: false, provider: p.name, detail: describeError(err) };
    }
  }

  /**
   * File the issue.
   *
   * Throws TrackerError with a hint. Callers record the failure on the ticket
   * rather than losing it: a push that failed must be visible and retryable,
   * because the alternative is a confirmed bug that quietly never reached the
   * developers.
   */
  async createIssue(input: TrackerIssueInput): Promise<TrackerIssue> {
    const p = this.provider();
    if (!p) {
      throw new TrackerError(
        'No issue tracker is configured.',
        400,
        'Set TRACKER_PROVIDER to jira, clickup or linear in backend/.env, with that provider’s credentials.',
        'jira',
      );
    }
    const missing = p.missingConfig();
    if (missing.length) {
      throw new TrackerError(
        `${p.name} is selected but not fully configured.`,
        400,
        `Add these to backend/.env: ${missing.join(', ')}`,
        p.name,
      );
    }

    this.logger.log(`Filing "${input.title}" into ${p.describe()}`);
    const issue = await p.create(input);
    this.logger.log(`Filed ${issue.key} at ${issue.url}`);
    for (const w of issue.warnings) this.logger.warn(`${issue.key}: ${w}`);
    return issue;
  }

  /**
   * Turn a result's stored evidence into attachable files.
   *
   * Paths from the database are relative to ARTIFACTS_DIR and arrive from a
   * generated filename, but they are still resolved and then checked to be
   * INSIDE that directory. Without that check a crafted `../../` path would
   * make the platform upload arbitrary local files to an external service —
   * which is a data-exfiltration bug, not a path bug.
   */
  async collectAttachments(evidence: {
    screenshotPath?: string | null;
    tracePath?: string | null;
    bugKey: string;
  }): Promise<TrackerIssueInput['attachments']> {
    const root = path.resolve(this.config.artifactsDir);
    const out: TrackerIssueInput['attachments'] = [];

    const add = async (rel: string | null | undefined, filename: string, contentType: string) => {
      if (!rel) return;
      const abs = path.resolve(root, rel);
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        this.logger.warn(`Refusing to attach ${rel}: outside the artifacts directory`);
        return;
      }
      try {
        const stat = await fs.promises.stat(abs);
        // Jira's default attachment cap is 10MB and ClickUp's is similar. A
        // rejected upload wastes a round trip and produces a confusing warning
        // on an otherwise fine ticket.
        if (!stat.isFile() || stat.size === 0 || stat.size > 9.5 * 1024 * 1024) return;
        out.push({ path: abs, filename, contentType });
      } catch {
        // Artifacts are pruned independently of the database, so a missing
        // file is expected on an old finding, not an error.
      }
    };

    await add(evidence.screenshotPath, `${evidence.bugKey}-screenshot.png`, 'image/png');
    await add(evidence.tracePath, `${evidence.bugKey}-trace.zip`, 'application/zip');
    return out;
  }
}

/** TrackerError already carries a hint; anything else gets its message. */
export function describeError(err: unknown): string {
  if (err instanceof TrackerError) return `${err.message} — ${err.hint}`;
  return err instanceof Error ? err.message : String(err);
}
