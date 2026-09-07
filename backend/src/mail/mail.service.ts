import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import { layout, type Row } from './templates';

/**
 * OUTBOUND EMAIL.
 *
 * Every send here obeys one rule: **email is never allowed to affect the thing
 * that triggered it.** A sign-in must succeed when the SMTP host is down, and a
 * finished test run must record its results even if the summary never arrives.
 * So `send()` catches everything, logs it, and returns a boolean nobody has to
 * check — no caller awaits an outcome, and none of them can throw.
 *
 * That is also why there is no retry queue: a retry queue that can lose a test
 * result is worse than a missed email. If delivery guarantees are needed later,
 * they belong in a real queue behind this interface, not in the call sites.
 *
 * WHEN MAIL_ENABLED is false (the default) every method is a no-op that logs at
 * debug level, so the platform runs perfectly with no mail server at all.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transport?: Transporter;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const mail = this.config.mail;
    if (!mail.enabled) {
      this.logger.log('Email is disabled (MAIL_ENABLED=false). No notifications will be sent.');
      return;
    }
    if (!mail.host || !mail.from) {
      this.logger.warn(
        'MAIL_ENABLED is true but MAIL_HOST or MAIL_FROM is missing — email stays off.',
      );
      return;
    }

    this.transport = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      // Port 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this
      // backwards is the single most common SMTP misconfiguration, so it is
      // derived from the port rather than left to the user.
      secure: mail.secure ?? mail.port === 465,
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
      connectionTimeout: mail.timeoutMs,
      greetingTimeout: mail.timeoutMs,
      socketTimeout: mail.timeoutMs,
    });

    this.logger.log(`Email enabled via ${mail.host}:${mail.port} as ${mail.from}`);
  }

  get enabled(): boolean {
    return Boolean(this.transport);
  }

  /** Confirms the SMTP credentials without sending anything. */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    if (!this.transport) {
      return {
        ok: false,
        detail:
          'Email is off. Set MAIL_ENABLED=true with MAIL_HOST, MAIL_FROM and credentials in backend/.env.',
      };
    }
    try {
      await this.transport.verify();
      return { ok: true, detail: `SMTP at ${this.config.mail.host} accepted the credentials.` };
    } catch (err) {
      return { ok: false, detail: describeSmtpError(err) };
    }
  }

  /**
   * The only place a message is actually sent. Never throws.
   *
   * Returns false rather than raising, so a caller can log a miss without
   * needing a try/catch around every notification.
   */
  private async send(to: string, subject: string, html: string, text: string): Promise<boolean> {
    if (!this.transport) {
      this.logger.debug(`Email off; would have sent "${subject}" to ${to}`);
      return false;
    }
    if (!to || !to.includes('@')) {
      this.logger.warn(`Refusing to send "${subject}": "${to}" is not an email address`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.config.mail.from, to, subject, html, text });
      this.logger.log(`Sent "${subject}" to ${to}`);
      return true;
    } catch (err) {
      // Deliberately swallowed. See the class comment.
      this.logger.warn(`Could not send "${subject}" to ${to}: ${describeSmtpError(err)}`);
      return false;
    }
  }

  private appUrl(path = ''): string {
    return `${this.config.mail.appUrl.replace(/\/$/, '')}${path}`;
  }

  // ======================================================= account events

  /**
   * NEW SIGN-IN ALERT.
   *
   * A security notice, not marketing — which is why it always names the time,
   * the IP and the device, and says plainly what to do if it was not them. An
   * alert that cannot be acted on is just noise in an inbox.
   */
  async sendLoginAlert(input: {
    to: string;
    name: string;
    at: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    isFirstLogin?: boolean;
  }): Promise<boolean> {
    const rows: Row[] = [
      { label: 'When', value: input.at.toUTCString() },
      { label: 'IP address', value: input.ipAddress || 'not recorded' },
      { label: 'Device', value: summariseUserAgent(input.userAgent) },
    ];

    const body = layout({
      preheader: `New sign-in to your AI QA account at ${input.at.toUTCString()}`,
      heading: input.isFirstLogin ? `Welcome, ${input.name}` : 'New sign-in to your account',
      intro: input.isFirstLogin
        ? 'Your account is ready. This is the first sign-in we have recorded for it — the details are below so you have a record of it.'
        : `Hello ${input.name}, your AI QA account was just signed in to. If that was you, nothing to do.`,
      rows,
      cta: { label: 'Review your sign-in history', url: this.appUrl('/account') },
      footnote:
        'If this was not you, change your password now and revoke the session from the Account page. ' +
        'Every sign-in is listed there with its IP and device.',
    });

    return this.send(
      input.to,
      input.isFirstLogin ? 'Welcome to AI QA' : 'New sign-in to your AI QA account',
      body.html,
      body.text,
    );
  }

  // =========================================================== run events

  /**
   * RUN FINISHED — the summary of what was tested and what broke.
   *
   * This is the "tell me when my audit is done" email. It leads with the counts
   * because that is the whole question, and it names the pages that could NOT
   * be tested: a summary that reports 24 passes while three pages were never
   * opened would be technically true and actively misleading.
   */
  async sendRunFinished(input: {
    to: string;
    name: string;
    runId: string;
    runName: string;
    targetUrl: string;
    wholeApp: boolean;
    summary: {
      totalPages: number;
      pagesFailed: number;
      totalCases: number;
      executed: number;
      passed: number;
      failed: number;
      flaky: number;
      errored: number;
      openFindings: number;
    };
    contentIssues: number;
    designIssues: number;
  }): Promise<boolean> {
    const s = input.summary;
    const broken = s.failed + s.errored;

    const headline =
      broken > 0
        ? `${broken} test${broken === 1 ? '' : 's'} failed on ${hostOf(input.targetUrl)}`
        : s.executed > 0
          ? `Everything passed on ${hostOf(input.targetUrl)}`
          : `Run finished on ${hostOf(input.targetUrl)}`;

    const rows: Row[] = [
      { label: 'Target', value: input.targetUrl },
      ...(input.wholeApp
        ? [{ label: 'Pages tested', value: `${s.totalPages - s.pagesFailed} of ${s.totalPages}` }]
        : []),
      { label: 'Tests run', value: `${s.executed} of ${s.totalCases}` },
      { label: 'Passed', value: String(s.passed), tone: 'pass' as const },
      ...(s.failed ? [{ label: 'Failed', value: String(s.failed), tone: 'fail' as const }] : []),
      ...(s.errored ? [{ label: 'Errored', value: String(s.errored), tone: 'fail' as const }] : []),
      ...(s.flaky ? [{ label: 'Flaky', value: String(s.flaky), tone: 'warn' as const }] : []),
      ...(input.contentIssues
        ? [{ label: 'Wording suggestions', value: String(input.contentIssues) }]
        : []),
      ...(input.designIssues
        ? [{ label: 'Design mismatches', value: String(input.designIssues) }]
        : []),
    ];

    // The honest caveat, stated in the email and not only in the app.
    const caveats: string[] = [];
    if (s.pagesFailed > 0) {
      caveats.push(
        `${s.pagesFailed} page${s.pagesFailed === 1 ? '' : 's'} could not be tested at all, so ` +
          'nothing in this summary says whether they work. The run page lists the reason for each.',
      );
    }
    if (s.openFindings > 0) {
      caveats.push(
        `${s.openFindings} failure${s.openFindings === 1 ? '' : 's'} need a human decision. ` +
          'They are findings, not bugs — nothing has been filed against your developers yet.',
      );
    }

    const body = layout({
      preheader: headline,
      heading: headline,
      intro:
        `Hello ${input.name}, your run “${input.runName}” has finished. ` +
        (broken > 0
          ? 'Each failure has a screenshot of the moment it broke, the console errors and the failed API calls.'
          : 'No test failed.'),
      rows,
      cta: { label: 'Open the full results', url: this.appUrl(`/runs/${input.runId}`) },
      callouts: caveats,
      footnote:
        'A failed test is not automatically a bug. Every failure is re-run once in a clean browser, ' +
        'and a person decides whether it is a real defect before anything is filed.',
    });

    return this.send(input.to, `${headline} — ${input.runName}`, body.html, body.text);
  }

  // ======================================================== defect events

  /**
   * A CONFIRMED DEFECT, and where it went.
   *
   * Sent when a human confirms a finding and a ticket is created — to the
   * assignee, because they are the person who has to act, and it carries the
   * tracker link so they never need to open this tool.
   */
  async sendBugFiled(input: {
    to: string;
    name: string;
    bugKey: string;
    ticketKey: string;
    title: string;
    severity?: string | null;
    priority?: string | null;
    targetUrl?: string | null;
    pageUrl?: string | null;
    findingId: string;
    external?: { provider: string; key: string; url: string } | null;
    pushError?: string | null;
  }): Promise<boolean> {
    const rows: Row[] = [
      { label: 'Bug', value: input.bugKey },
      { label: 'Ticket', value: input.ticketKey },
      ...(input.severity ? [{ label: 'Severity', value: prettyEnum(input.severity) }] : []),
      ...(input.priority ? [{ label: 'Priority', value: input.priority }] : []),
      ...(input.pageUrl || input.targetUrl
        ? [{ label: 'Page', value: (input.pageUrl ?? input.targetUrl) as string }]
        : []),
      ...(input.external
        ? [{ label: prettyProvider(input.external.provider), value: input.external.key }]
        : []),
    ];

    const body = layout({
      preheader: `${input.bugKey} assigned to you: ${input.title}`,
      heading: `${input.bugKey} is assigned to you`,
      intro:
        `Hello ${input.name}, a QA reviewer confirmed this as a real defect and it is now ` +
        `${input.ticketKey}. The full bug report — steps, expected vs actual, screenshot, ` +
        'console and API errors — is on the ticket.',
      rows,
      cta: input.external
        ? { label: `Open ${input.external.key}`, url: input.external.url }
        : { label: `Open ${input.ticketKey}`, url: this.appUrl('/tickets') },
      callouts: input.pushError
        ? [
            `This was NOT filed in your issue tracker: ${input.pushError} ` +
              'The ticket exists here, and you can retry the push from the ticket page.',
          ]
        : [],
      footnote:
        'When you have fixed it, move the ticket to Ready for Retest and the original test will ' +
        're-run against your fix.',
    });

    return this.send(input.to, `${input.bugKey}: ${input.title}`.slice(0, 180), body.html, body.text);
  }
}

/** "chrome 151 on Windows" rather than 180 characters of UA string. */
export function summariseUserAgent(ua?: string | null): string {
  if (!ua) return 'unknown device';
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0].replace('Edg/', 'Edge ') ??
    /Chrome\/([\d.]+)/.exec(ua)?.[0].replace('Chrome/', 'Chrome ') ??
    /Firefox\/([\d.]+)/.exec(ua)?.[0].replace('Firefox/', 'Firefox ') ??
    /Version\/([\d.]+).*Safari/.exec(ua)?.[1].replace(/^/, 'Safari ') ??
    'unknown browser';
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser.split('.')[0]} on ${os}`;
}

function hostOf(url?: string | null): string {
  if (!url) return 'your site';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function prettyEnum(v: string): string {
  return v.replace(/^S\d_/, '').replace(/_/g, ' ').toLowerCase();
}

function prettyProvider(p: string): string {
  return p === 'clickup' ? 'ClickUp' : p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * SMTP errors are unusually cryptic, and the three common ones have specific
 * fixes that nobody guesses from the raw message.
 */
export function describeSmtpError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? '';

  if (code === 'EAUTH' || /invalid login|username and password/i.test(raw)) {
    return (
      `${raw} — the SMTP username or password is wrong. For Gmail you must use a 16-character ` +
      'App Password (myaccount.google.com/apppasswords) with 2FA on; your normal password will ' +
      'always be rejected.'
    );
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return `${raw} — could not reach the SMTP host. Check MAIL_HOST, MAIL_PORT (587 or 465) and any firewall.`;
  }
  if (/self.signed|certificate/i.test(raw)) {
    return `${raw} — TLS problem. If MAIL_PORT is 465 set MAIL_SECURE=true; for 587 set MAIL_SECURE=false.`;
  }
  return raw;
}
