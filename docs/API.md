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
  "url": "https://staging.example.com/login",
  "requirements": "A user can type an email.\nClicking Login with valid credentials opens the dashboard.\nA wrong password shows an error.",
  "name": "Login smoke",
  "credentials": { "email": "test@example.com", "password": "secret" },
  "authorized": true,
  "allowDestructive": false
}
```

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Must include the protocol. Defines the only origin the run may touch. |
| `requirements` | yes | Min 10 chars. The source of truth. |
| `name` | no | Defaults to `host - path`. |
| `credentials` | no | Encrypted immediately. Never returned by any endpoint. Never sent to the LLM. |
| `authorized` | yes | `false` → `400`. |
| `allowDestructive` | no | Default `false`. |

`400` when unauthorised or when the host is a private/metadata address.

### `GET /runs`

Last 50 runs with counts. Poll this for the dashboard list.

### `GET /runs/:id`

**Everything the run page needs in one call**: the run, the page snapshot, all test cases with their results, all findings with their event history, all policy rejections, and a computed `summary`.

```json
{
  "id": "…",
  "status": "AWAITING_APPROVAL",
  "statusMessage": "5 test case(s) ready for review.",
  "pageSnapshot": { "elements": [{ "kind": "input", "label": "Email", "labelSource": "label-for" }] },
  "llmModel": "openai/gpt-oss-120b",
  "llmTokensIn": 1840,
  "llmTokensOut": 920,
  "hasCredentials": true,
  "testCases": [{ "id": "…", "title": "…", "steps": [], "assertions": [], "approved": false, "results": [] }],
  "findings": [],
  "rejections": [],
  "summary": {
    "totalCases": 5, "approvedCases": 0, "executed": 0,
    "passed": 0, "failed": 0, "errored": 0, "flaky": 0,
    "openFindings": 0, "confirmedFindings": 0
  }
}
```

**Run statuses**

| Status | Meaning | Poll? |
|---|---|---|
| `CREATED` | queued | yes |
| `SCANNING` | Playwright is reading the page | yes |
| `SCAN_FAILED` | page unreachable, blocked, or empty | no |
| `PLANNING` | the LLM is writing test cases | yes |
| `PLAN_FAILED` | LLM error, or everything rejected by policy | no |
| `AWAITING_APPROVAL` | needs a human | no |
| `RUNNING` | executing approved cases | yes |
| `COMPLETED` | finished (may still contain failures) | no |

### `POST /runs/:id/execute`

Runs every approved, non-rejected case. `400` if none are approved, or if the run is already executing.

```json
{ "started": true, "approvedCount": 3 }
```

### `POST /runs/:id/replan`

Deletes the AI-authored cases and rejections, re-scans, and asks the model again. Manual cases are kept.

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
