# API reference

Base URL: `http://localhost:4000/api`

Every error uses one shape, produced by `common/filters/all-exceptions.filter.ts`:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": ["url must be a full URL including http:// or https://"],
  "path": "/api/runs",
  "timestamp": "2026-08-19T10:12:33.000Z"
}
```

---

## Diagnostics

### `GET /health`

Tells you which of the three pieces is broken. Check this first.

```json
{
  "ok": true,
  "database": { "ok": true },
  "llm": {
    "provider": "groq",
    "model": "openai/gpt-oss-120b",
    "baseUrl": "https://api.groq.com/openai/v1",
    "keyLoaded": true
  },
  "browser": { "headless": true, "viewport": { "width": 1366, "height": 768 } },
  "artifactsDir": "E:\\AI Automation Product\\artifacts"
}
```

`keyLoaded` proves a key is present. The key itself is never returned.

### `GET /llm/models`

Model ids the configured key can reach. Use when `LLM_MODEL` is wrong.

```json
{ "models": ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"], "current": "openai/gpt-oss-120b" }
```

### `GET /capabilities`

The allow-list, plus the active policy limits. Drives the editor hints in the UI.

```json
{
  "actions": ["goto", "click", "fill", "select", "check", "uncheck", "press", "hover", "waitForUrl", "waitForVisible"],
  "assertions": ["urlContains", "urlNotContains", "visible", "notVisible", "textContains", "textNotContains", "valueEquals", "titleContains", "elementCountAtLeast", "noConsoleErrors", "noApiErrors"],
  "valueRefs": ["test_email", "test_password"],
  "policy": { "maxTestCasesPerRun": 12, "maxStepsPerCase": 25, "retryFailedOnce": true }
}
```

---

## Runs

### `POST /runs`

The only thing the user has to fill in. Returns immediately; planning continues in the background.

```json
{
  "url": "https://staging.example.com",
  "requirements": "A user can type an email.\nClicking Login with valid credentials opens the dashboard.\nA wrong password shows an error.",
  "name": "Staging smoke",
  "checks": ["page_loads", "no_console_errors", "fields_accept_input"],
  "credentials": { "email": "test@example.com", "password": "secret" },
  "loginUrl": "https://staging.example.com/login",

  "crawlEnabled": true,
  "maxPages": 12,
  "maxDepth": 2,
  "excludePaths": ["/admin", "?preview="],

  "figmaFileKey": "https://www.figma.com/design/AbC123/Kit?node-id=18-0",
  "figmaNodeId": "https://www.figma.com/design/AbC123/Kit?node-id=18-0",
  "designPageUrl": "https://staging.example.com/login",

  "authorized": true,
  "allowDestructive": false
}
```

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Must include the protocol. Defines the only origin the run may touch. With `crawlEnabled` it is the **entry** URL every other page is discovered from. |
| `requirements` | no* | The source of truth for business rules. *One of `requirements` (min 10 chars) or a non-empty `checks` is required. |
| `checks` | no* | Ids from `GET /capabilities`. Unknown ids are dropped, not rejected. |
| `name` | no | Defaults to `host - path`, or `host - whole app` when crawling. |
| `credentials` | no | Encrypted immediately. Never returned by any endpoint. Never sent to the LLM. |
| `loginUrl` | no | Must be the same origin as `url`. Signs in once **before** the crawl and the scans. |
| `authorized` | yes | `false` → `400`. |
| `allowDestructive` | no | Default `false`. |

**Whole-app scope**

| Field | Default | Notes |
|---|---|---|
| `crawlEnabled` | `false` | `true` discovers the app's pages by following same-origin links from `url`, then scans, plans and runs every check against each. |
| `maxPages` | `CRAWL_DEFAULT_MAX_PAGES` (10) | Clamped to `CRAWL_MAX_PAGES_HARD` (50). Each page costs one browser scan plus one LLM call. |
| `maxDepth` | `CRAWL_DEFAULT_MAX_DEPTH` (2) | Link depth from the entry URL. Clamped to `CRAWL_MAX_DEPTH_HARD` (5). |
| `includePaths` | `[]` | A discovered path must contain one of these. Empty = the whole origin. |
| `excludePaths` | `[]` | Skips matching paths, on top of the always-excluded set (sign-out, destructive words, assets). |

**Design comparison**

| Field | Notes |
|---|---|
| `figmaFileKey` | The file key, or the whole Figma URL — the backend parses either. |
| `figmaNodeId` | `18:0`, `18-0`, or the whole URL containing `node-id=`. |
| `designPageUrl` | **Which single page the frame is compared against.** Defaults to `url`. Must be the same origin. The design check stays single-page even when the run crawls the whole app — a Figma frame is one screen's design. |

`400` when unauthorised, when the host is a private/metadata address, when `loginUrl` or
`designPageUrl` is on a different origin, or when a `loginUrl` is given with no credentials.

### `GET /runs`

Last 50 runs with counts. Poll this for the dashboard list.

### `GET /runs/:id`

**Everything the run page needs in one call**: the run, its pages, the entry page snapshot, all
test cases with their results, all findings with their event history, all policy rejections, and a
computed `summary`.

```json
{
  "id": "…",
  "status": "AWAITING_APPROVAL",
  "statusMessage": "31 test case(s) across 9 page(s), ready for review.",
  "crawlEnabled": true,
  "maxPages": 12,
  "maxDepth": 2,
  "pageSnapshot": { "elements": [{ "kind": "input", "label": "Email", "labelSource": "label-for" }] },
  "designPageUrl": "https://staging.example.com/login",
  "designSpecSummary": "Kit in \"Design system\" - 2196 layers. … Compared against /login: 612 value(s) matched, 11 deviation(s) across 284 element(s) (5 colour, 3 size, 2 typography, 1 icon).",
  "llmModel": "openai/gpt-oss-120b",
  "llmTokensIn": 18400,
  "llmTokensOut": 9200,
  "hasCredentials": true,

  "pages": [
    {
      "id": "…", "url": "https://staging.example.com/", "path": "/",
      "title": "Staging", "isEntry": true, "depth": 0, "order": 0,
      "status": "PLANNED", "statusMessage": "4 test case(s) proposed.",
      "elementCount": 27,
      "_count": { "testCases": 4, "contentIssues": 1, "designIssues": 0 }
    },
    {
      "id": "…", "url": "https://staging.example.com/reports", "path": "/reports",
      "isEntry": false, "discoveredFrom": "https://staging.example.com/", "depth": 1, "order": 4,
      "status": "SCAN_FAILED",
      "statusMessage": "The page never rendered any interactive content within 15000ms. …",
      "elementCount": 0
    }
  ],

  "testCases": [
    { "id": "…", "pageId": "…", "pageUrl": "https://staging.example.com/",
      "title": "…", "steps": [], "assertions": [], "approved": false, "results": [] }
  ],
  "findings": [],
  "rejections": [
    { "id": "…", "stage": "CRAWL_SKIPPED", "subject": "https://staging.example.com/logout",
      "reason": "Signing out would destroy the run's session", "pageUrl": null }
  ],
  "summary": {
    "totalPages": 9, "pagesPlanned": 7, "pagesFailed": 1, "pagesSkipped": 1,
    "totalCases": 31, "approvedCases": 0, "executed": 0,
    "passed": 0, "failed": 0, "errored": 0, "flaky": 0,
    "openFindings": 0, "confirmedFindings": 0
  }
}
```

`pages` is present on every run — a single-page run has exactly one entry, with `isEntry: true`.
**`pageSnapshot` is deliberately omitted from each page here**: a twelve-page run's snapshots
total several megabytes and this endpoint is polled while the run is in progress. Fetch one with
`GET /runs/:id/pages/:pageId`.

`summary.pagesFailed` matters more than it looks: a run can report every test green while a
quarter of the app was never opened. Surface it.

**Page statuses**

| Status | Meaning |
|---|---|
| `DISCOVERED` | found by the crawler, not read yet |
| `SCANNING` | Chrome is on this page now |
| `SCANNED` | snapshot captured, awaiting its plan |
| `PLANNED` | test cases proposed for this page |
| `SCAN_FAILED` | unreachable, blocked, or rendered nothing — **no tests exist for it** |
| `PLAN_FAILED` | read, but the model or the policy engine produced nothing |
| `SKIPPED` | over the run-wide case budget, or excluded by the user |

**Rejection stages** include `CRAWL_SKIPPED` — a link the crawler deliberately did not follow.
Not a rejected test step, but the same question: what was left out, and why.

### `GET /runs/:id/pages/:pageId`

One page of a run, with the snapshot the AI was shown for it plus that page's advisory lists.
Separate from `GET /runs/:id` for payload-size reasons only.

```json
{
  "id": "…",
  "url": "https://staging.example.com/settings",
  "path": "/settings",
  "status": "PLANNED",
  "pageSnapshot": { "title": "Settings", "elements": [], "forms": [], "headings": [] },
  "contentIssues": [{ "id": "…", "kind": "TYPO", "text": "Contnue", "suggestion": "Continue" }],
  "designIssues": [],
  "testCases": [{ "id": "…", "title": "…", "priority": "P2" }]
}
```

`404` if the page does not belong to that run.

**Run statuses**

| Status | Meaning | Poll? |
|---|---|---|
| `CREATED` | queued | yes |
| `SCANNING` | Playwright is finding the app's pages, then reading them | yes |
| `SCAN_FAILED` | **no** page could be read. One unreadable page among many does not do this — it fails that `RunPage` only | no |
| `PLANNING` | the LLM is writing test cases | yes |
| `PLAN_FAILED` | no page produced a single accepted case | no |
| `AWAITING_APPROVAL` | needs a human | no |
| `RUNNING` | executing approved cases | yes |
| `COMPLETED` | finished (may still contain failures) | no |

### `POST /runs/:id/execute`

Runs every approved, non-rejected case. `400` if none are approved, or if the run is already executing.

```json
{ "started": true, "approvedCount": 3 }
```

### `POST /runs/:id/replan`

Deletes the AI-authored cases, the rejections and the un-promoted advisory rows, re-scans **every
page of the run**, and asks the model again. Manual cases are kept, and so are advisory rows a
human already promoted into a bug — deleting one would leave a `BUG-00n` pointing at nothing.

**The set of pages is kept**, deliberately: re-crawling would spend another minute rediscovering
the same URLs, and a nav bar that changed in the meantime would quietly change what the run
covers — so "re-plan" would stop meaning "plan the same thing again". Create a new run to pick up
new pages.

---

## Test cases

### `GET /test-cases/:id`

One case with all its results, console logs, network logs and finding.

### `PATCH /test-cases/:id`

Edit a case. **Re-validated by the policy engine** — a rejected edit is not saved.

```json
{
  "title": "User can log in with valid credentials",
  "priority": "P0",
  "steps": [
    { "action": "fill", "target": "Email", "valueRef": "test_email" },
    { "action": "fill", "target": "Password", "valueRef": "test_password" },
    { "action": "click", "target": "Sign in" }
  ],
  "assertions": [{ "type": "urlContains", "value": "/dashboard" }]
}
```

`400` with `details` listing each policy violation:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The edited test case violates the execution policy and was not saved.",
  "details": ["DESTRUCTIVE: Target looks destructive (\"Delete account\")…"]
}
```

Sending `steps` or `assertions` flips `source` to `MANUAL`.

### `POST /test-cases/:id/approve` · `POST /test-cases/:id/reject`

`reject` takes an optional `{ "reason": "…" }`.

### `POST /runs/:runId/test-cases/approve-all`

```json
{ "approved": 5 }
```

### `POST /test-cases/:id/retest`

Re-runs this one case now and returns the new result. This is the **"Ready for Retest"** action — a developer says it is fixed, QA presses retest. Synchronous, because the user is watching one test.

---

## Results

### `GET /results/:id`

The evidence payload. Console and network logs are pre-split so the frontend does not have to filter.

```json
{
  "status": "FAIL",
  "attempt": 2,
  "durationMs": 4210,
  "errorType": "ASSERTION_FAILED",
  "errorMessage": "URL should contain \"/dashboard\" but it is \"https://app/login\"",
  "expected": "url contains \"/dashboard\"",
  "actual": "https://app/login",
  "failedStepLabel": "assertion 1: urlContains",
  "finalUrl": "https://app/login",
  "browserName": "chromium",
  "browserVersion": "131.0.6778.33",
  "viewport": "1366x768",
  "stepResults": [
    { "index": 0, "action": "fill", "target": "Email", "status": "passed", "locatorStrategy": "label", "durationMs": 120, "message": "filled from test_email" },
    { "index": 1000, "action": "assert:urlContains", "target": "", "status": "failed", "durationMs": 0, "message": "URL should contain …" }
  ],
  "screenshotPath": "runId/caseId-attempt2.png",
  "tracePath": "runId/caseId-attempt2-trace.zip",
  "consoleErrors": [{ "level": "ERROR", "message": "Failed to load resource: 401" }],
  "apiErrors": [{ "method": "POST", "url": "https://app/api/login", "status": 401, "isApiError": true }]
}
```

Assertions are stored in `stepResults` with `index >= 1000` so they sort after the actions and render as one continuous timeline.

**Error types**

| `errorType` | Meaning | Usually means |
|---|---|---|
| `ASSERTION_FAILED` | a deterministic check failed | a real product problem — investigate |
| `LOCATOR_NOT_FOUND` | no strategy matched the target | test defect: the generated label is wrong |
| `TIMEOUT` | action or navigation exceeded its limit | slow app, or a wrong wait |
| `NAVIGATION` | DNS, TLS, connection refused | environment |
| `PAGE_CRASH` | the tab died | product or environment |
| `UNKNOWN` | unclassified | read the message |

---

## Findings

### `GET /findings?status=NEW&runId=…`

The triage inbox. Both filters are optional.

### `GET /findings/stats`

```json
{ "NEW": 3, "TRIAGED": 0, "CONFIRMED": 1, "REJECTED": 4, "REOPENED": 1, "CLOSED": 2 }
```

### `GET /findings/:id`

The full bug report: test case, run, result with every log, and the complete event history.

### `POST /findings/:id/triage`

**The human verdict.** This is what makes something a bug.

```json
{
  "decision": "CONFIRM",
  "classification": "PRODUCT_BUG",
  "severity": "S1_BLOCKER",
  "note": "Reproduced by hand. Login API returns 401 for a valid user.",
  "assignee": "dev@team.com"
}
```

| Field | Values |
|---|---|
| `decision` | `CONFIRM` → `CONFIRMED`, `REJECT` → `REJECTED` |
| `classification` | `PRODUCT_BUG` · `TEST_DEFECT` · `ENVIRONMENT_ISSUE` · `TEST_DATA_ISSUE` · `FLAKY` · `UNKNOWN` |
| `severity` | `S1_BLOCKER` · `S2_MAJOR` · `S3_MINOR` · `S4_TRIVIAL` |

### `POST /findings/:id/reopen`

It came back. Increments `occurrences` and records the event. Optional `{ "note": "…" }`.

### `POST /findings/:id/close`

### `POST /findings/:id/comments`

A note without a status change. Still recorded in the audit trail. `{ "note": "…" }` required.

**Allowed transitions** — anything else returns `400` naming what is allowed:

| From | To |
|---|---|
| `NEW` | `TRIAGED`, `CONFIRMED`, `REJECTED` |
| `TRIAGED` | `CONFIRMED`, `REJECTED` |
| `CONFIRMED` | `CLOSED`, `REJECTED` |
| `REJECTED` | `REOPENED`, `CONFIRMED` |
| `REOPENED` | `CONFIRMED`, `REJECTED`, `CLOSED` |
| `CLOSED` | `REOPENED` |

**AI fields are advisory.** `aiClassification`, `aiConfidence`, `aiSummary`, `aiSuspectedCause`, `aiEvidence` are suggestions. `humanClassification`, `severity`, `triagedBy`, `triagedAt` are the record of the decision. The UI must always label the AI fields as suggestions.

---

## Artifacts

### `GET /artifacts/<path>`

Serves a screenshot (`image/png`) or trace (`application/zip`, as a download). Paths come from `screenshotPath` / `tracePath` on a result.

Path traversal is blocked: the resolved absolute path must stay inside `ARTIFACTS_DIR`.

---

## Projects

Auto-created per origin by `POST /runs`, so the UI never has to.

```
POST /projects          { "name": "…", "baseUrl": "https://…" }
GET  /projects
GET  /projects/:id      with the last 20 runs
```
