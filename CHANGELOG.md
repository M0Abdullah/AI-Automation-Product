# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] — 2026-09-10

The release that turns a single-page prototype into something a team can point
at a whole application.

### Added

**Whole-app test runs.** Tick *Test the whole app* and the platform discovers
your application's pages by following same-origin links from the entry URL,
then scans, plans and executes every ticked check against **each** page — one
run, one approval gate, one findings list. Previously five pages meant five
separate runs.

The crawler is bounded on purpose: same origin only, breadth-first, anchors
only (it never clicks), deduplicated by normalised URL, and it **never follows
sign-out** — that would destroy the run's session and turn every subsequent
page into the login screen. Links it declines to follow are recorded with the
reason rather than dropped silently.

**Per-page status.** A twelve-page run is not one thing that succeeds or fails.
Each page carries its own state (`SCANNED` / `PLANNED` / `SCAN_FAILED` /
`SKIPPED`) with the reason, and `summary.pagesFailed` is surfaced next to the
approve button — a suite reporting itself green while a quarter of the app was
never opened is the one dishonest thing whole-app testing could do.

**Issue tracker integration — Jira, ClickUp and Linear.** A confirmed defect is
created as a **real issue via API**, with the generated bug report as the
description and the failure screenshot plus the Playwright trace uploaded as
attachments. Any number of trackers can be configured at once, and the
destination is chosen per bug rather than fixed in deployment config.

Deliberately **not** triggered by a failing test — only by a human confirming
one. A failing test has five possible causes and only one is a defect; a tool
that files automatically spends its first week filling a backlog with its own
mistakes. Pushes are idempotent, and a failed push is recorded on the ticket
and retryable.

**Email notifications.** Five events, each fire-and-forget so a mail outage can
never fail a sign-in or lose a test result:

| Event | Recipient |
|---|---|
| New sign-in | that account, with time, IP and device |
| Testing started | whoever started the run, once the page count is known |
| **Tests ready for approval** | whoever started the run |
| Run finished | whoever started the run, with pass/fail and pages-not-tested |
| Bug confirmed | the assignee, with the tracker link |

The third one matters most: the pipeline deliberately *stops* at the approval
gate, so without that email a run sits unapproved forever while the user
believes work is happening.

**Deeper Figma design comparison.** Eleven properties in five families — sizes
(button and control heights, corner radii), typography (size, family, weight),
**colour** (text, background, border), **spacing** (padding, gaps) and **icon
sizes**. Colour is compared by weighted perceptual distance rather than string
equality. Still single-page by design: a Figma frame *is* one screen, and
checking twelve pages against one frame produces a wall of confident, wrong
findings.

**Integrations panel** with per-service *Test* buttons that verify credentials
without filing a junk issue or sending a test email.

### Changed

**Database: SQLite → MongoDB.** The two things SQLite forced the codebase to
fake are native here, so both workarounds were deleted: `src/common/db-json.ts`
(JSON stored as text) and `src/common/hydrate.ts` (reassembling every response)
are gone. Steps, assertions, step timelines, page snapshots and AI evidence are
now real documents; tags, checks and labels are real arrays.

Requires a **replica set** — Prisma needs one. `docker compose up -d` provides a
single-node set, and `scripts/setup-mongo-replicaset.ps1` configures a native
Windows install.

**New "Instrument" UI theme.** True-neutral dark chassis with a measurement
graticule, signal-lime accent, monospace for every value, and status shown as
lit signal lights. The previous violet-tinted surfaces were a functional
problem, not just a stylistic one: a tinted ground made the green PASS dot read
teal and the amber FLAKY dot read pink.

**Login checks are page-aware.** The Login group is only handed to pages that
actually have a sign-in, instead of producing eleven cases that hunt for a
password field on the dashboard and fail with `LOCATOR_NOT_FOUND`.

**Two case budgets instead of one.** `MAX_TEST_CASES_PER_PAGE` (8, unchanged
per page) and `MAX_TEST_CASES_PER_RUN` (60, across all pages). Only one cap
would either starve later pages or produce a 96-case plan nobody reviews.

### Fixed

**A unique index made the platform able to hold exactly one finding.** Prisma
creates MongoDB unique indexes *non-sparse*, and MongoDB indexes a **missing**
field as `null` — so two findings that both omitted `contentIssueId` collided.
The second finding ever created failed. `@unique` is now used only on required
fields; optional ones get a plain index with uniqueness enforced in the
services.

**One failing test abandoned the rest of the suite.** The error above escaped
the execution loop, which marked the run `COMPLETED` after 2 of 6 tests with
four sitting blank and nothing indicating a problem. Each case now runs in its
own error boundary and an abandoned case gets a real `ERROR` result.

**Pass/fail counts were inflated.** A failed test writes two result rows (the
automatic reproducibility rerun), so three failures were reported as "6 FAIL"
— implying nine tests in a six-test run. Counts now use the latest result per
case, the same rule the run page and the summary email use.

**Duplicate bug key in email subjects** (`BUG-005: BUG-005: …`).

**CORS rejected `127.0.0.1` and LAN addresses**, so opening the app at anything
but exactly `localhost:3000` broke every API call.

---

## [0.2.0] — 2026-08-31

### Added
- **Design vs Figma** comparison — button heights, corner radii, type scale and
  fonts read from a Figma frame as a specification, then checked on the live
  page. Near-misses only.
- **Wording review** — typos, grammar, mismatched labels and shipped
  `Lorem ipsum` in the page's own copy. Advisory, never a failure.
- **Session reuse** — sign in once before the scan and reuse that session for
  every test, which is what makes an application's interior testable.
- **Stuck-loader** and **server-data-rendered** checks.
- **Bug category** as an axis independent of classification: a defect can be
  `PRODUCT_BUG` + `UI_VISUAL` or `PRODUCT_BUG` + `DATA`, and a triager needs
  both to route it.

---

## [0.1.0] — 2026-08-19

Initial release.

### Added
- Tick-box check catalogue — 13 checks that need no test writing.
- AI test-case generation constrained to elements the browser actually found,
  and to assertions the user actually wrote.
- Policy engine validating every step against an allow-list: action
  allow-list, same-origin navigation, SSRF blocking, destructive-keyword
  refusal, and rejection of any case with zero assertions.
- Human approval gate — nothing runs unapproved.
- Real Chrome execution via Playwright, with deterministic assertions deciding
  PASS/FAIL. The model never votes.
- Evidence capture: screenshots, Playwright traces, console errors, failed API
  calls, step timelines, environment.
- Automatic reproducibility rerun and `FLAKY` detection.
- AI failure triage as an advisory suggestion with confidence and quoted
  evidence.
- Findings → bug reports (`BUG-001`) as PDF, Markdown or HTML.
- Ticket workflow with assignee, lifecycle, comments and retest.
- Accounts and roles (OWNER / QA / DEV / VIEWER) enforced by the API.
- Full audit trail.

[0.3.0]: https://github.com/M0Abdullah/AI-Automation-Product/releases/tag/v0.3.0
[0.2.0]: https://github.com/M0Abdullah/AI-Automation-Product/releases/tag/v0.2.0
[0.1.0]: https://github.com/M0Abdullah/AI-Automation-Product/releases/tag/v0.1.0
