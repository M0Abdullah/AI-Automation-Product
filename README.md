<div align="center">

# AI Testing Platform

**Paste a URL. Tick what to check. Get real browser tests, run in Chrome, with bug reports.**

No test-writing skills needed. A human approves everything before it runs.

[![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![Playwright](https://img.shields.io/badge/Playwright-Chrome-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma&logoColor=white)](https://prisma.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
![Status](https://img.shields.io/badge/status-MVP-blue)

</div>

---

## 🚀 What it is

A web app that **tests other websites for you**.

You give it a page and tick what should be checked. It opens the page in **real Google Chrome**, reads what's on it, asks an AI to write the test cases, and waits for you to approve them. Then it runs them and tells you what broke — with a screenshot, the console errors, and the failed API calls.

Every failure is a **finding**, not a bug. You decide if it's real. Only then does it get a **BUG-001** number, a PDF report, and a ticket assigned to a developer.

```
     You                    Chrome                 AI                  You
      │                       │                     │                   │
  paste URL ──────────────► reads the page          │                   │
  tick checks                 │                     │                   │
      │                  what's on it ───────────► writes tests         │
      │                       │                     │                   │
      │                       │              ┌─ safety gate ─┐          │
      │                       │              │ every step     │         │
      │                       │              │ validated      │         │
      │                       │              └────────────────┘         │
      │                       │                     └──────────► approve or edit
      │                       │                                         │
      │                  runs them ◄────────────────────────────────────┘
      │                       │
      │                  PASS / FAIL ──────► failure? ──► AI explains ──► you confirm
      │                                                                    │
      │                                              BUG-001 → PDF → TICKET-001 → Jira
```

**Three parts, three jobs.** The AI decides *what* to test. The backend validates and stores. Chrome does the clicking and decides PASS/FAIL. The AI never touches the browser and never decides whether a test passed.

---

## 📸 Screenshots

### 1. Start a test — tick boxes, don't write code

Eleven ready-made checks that work on any page. Writing requirements is optional, for business rules only.

![Start a test](docs/screenshots/02-start-a-test.png)

### 2. Review what the AI wrote — nothing runs until you approve

![Review tests](docs/screenshots/03-review-tests.png)

### 3. Results — plain English, one line per test

![Results](docs/screenshots/04-results.png)

### 4. Failures — the AI explains, you decide

Its opinion is labelled a suggestion. The screenshot of the moment it broke is right there.

![Failures](docs/screenshots/05-failures.png)

### 5. Bug ticket — assigned, tracked, linked to Jira

The description is the generated bug report. Nothing retyped.

![Bug ticket](docs/screenshots/06-bug-ticket.png)

### 6. Dashboard — is the suite healthy, and what needs me today

![Dashboard](docs/screenshots/07-dashboard.png)

<details>
<summary>Sign-in screen</summary>

![Sign in](docs/screenshots/01-sign-in.png)

</details>

---

## ✨ Key features

| | |
|---|---|
| ✅ **Tick-box checks** | 11 ready-made checks — no test writing required |
| ✅ **AI test generation** | Plain-English requirements → structured test cases |
| ✅ **Real Chrome execution** | Not a headless simulation; falls back to Chromium |
| ✅ **Human approval gate** | Nothing runs until a person approves it |
| ✅ **Deterministic PASS/FAIL** | Assertions decide, never the AI |
| ✅ **Screenshots + traces** | Full-page capture and frame-by-frame replay |
| ✅ **Console + API errors** | `POST /api/login → 401` captured automatically |
| ✅ **Reproducibility check** | Every failure re-runs once in a clean browser |
| ✅ **AI failure triage** | Suggests product bug vs test defect vs environment |
| ✅ **Bug reports** | `BUG-001` as PDF, Markdown or HTML |
| ✅ **Ticket workflow** | Assignee, lifecycle, comments, retest, Jira link |
| ✅ **Accounts + roles** | OWNER / QA / DEV / VIEWER, enforced by the API |
| ✅ **Full audit trail** | Who decided what, and when |

---

## 🧪 What it tests

### Tick-box checks — no writing required

| Group | Check | What it verifies |
|---|---|---|
| **Basics** | Page loads correctly | Opens, and has a real title |
| | No JavaScript errors | Browser console is clean |
| | No broken API calls | No request returns 4xx/5xx |
| | Main content is visible | Headings actually render |
| **Forms** | Fields accept typing | Every input takes text and keeps it |
| | Required-field validation | Empty submit is rejected |
| | Email format is checked | `abc` is refused |
| **Navigation** | Links go to the right place | Each link navigates |
| | Buttons don't break the page | No crash on click |
| **Login** | Login works | The test account signs in |
| | Wrong password is rejected | A bad password doesn't get in |

### Your own requirements — for business rules

```
Logging in with valid credentials shows "You logged into a secure area".
A wrong password shows an error message and stays on /login.
The email field rejects a value that is not an email address.
```

The AI is **forbidden** from asserting anything you didn't write. That's what stops it inventing expectations and filing false bugs.

### Evidence captured on every failure

| Evidence | Example |
|---|---|
| Result | `PASS` / `FAIL` / `FLAKY` / `ERROR` |
| Error type | `ASSERTION_FAILED`, `LOCATOR_NOT_FOUND`, `TIMEOUT`, `NAVIGATION`, `PAGE_CRASH` |
| Expected vs actual | expected `/dashboard`, actual `/login` |
| Step timeline | `fill "Email" → matched by label → 120ms → passed` |
| **Screenshot** | full page, at the moment of failure |
| **Playwright trace** | replay the run frame by frame |
| Console errors | with source location |
| **API errors** | `POST /api/login → 401` |
| Network failures | `net::ERR_NAME_NOT_RESOLVED` |
| Environment | `chrome 151.0.7922.138 · 1366x768` |
| Reproducibility | first attempt vs the automatic clean rerun |
| AI analysis | classification + confidence + the evidence it quoted |

---

## 🏁 Getting started

**Requirements:** Node 20+, and Google Chrome installed (falls back to bundled Chromium).

```bash
# 1. Backend
cd backend
cp .env.example .env          # then add your LLM key (see below)
npm install
npx prisma migrate dev
npx playwright install chromium
npm run start:dev             # http://localhost:4000

# 2. Frontend  (second terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Open <http://localhost:3000>, create an account (**the first account becomes the owner**), and press **Test a page**.

There is **no database to install** — SQLite writes one file at `backend/prisma/dev.db`.

### 🔑 The two values you must set

`backend/.env`:

```ini
# Free key from https://console.groq.com  →  API Keys
LLM_API_KEY=gsk_...

# Any 32 random bytes:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=...
```

### Verify before you build on it

```bash
cd backend
npm run check:llm       # is my key valid? which models can I use?
npm run check:browser   # does Chrome work? what does the scanner see?
```

`check:browser` accepts a URL and prints exactly what the AI will be given:

```bash
npm run check:browser -- https://your-site.com/login
```

<details>
<summary>All the handy scripts</summary>

| Command | What it does |
|---|---|
| `.\kill-ports.ps1` | Frees ports 3000/4000 and kills stray watch processes |
| `npm run check:llm` | Verifies the LLM key, lists usable model ids |
| `npm run check:browser -- <url>` | Verifies Chrome, previews a page scan |
| `npm run set:owner -- --to a@b.com` | Changes an account's email / promotes it to owner |
| `npx prisma studio` | Browse the database in a GUI |

</details>

<details>
<summary>Every environment variable</summary>

The full annotated list lives in [`backend/.env.example`](backend/.env.example). The ones worth knowing:

| Variable | Default | What it does |
|---|---|---|
| `LLM_API_KEY` | — | **Required.** Groq or OpenAI key |
| `JWT_SECRET` | — | **Required.** 32 random bytes as hex |
| `LLM_MODEL` | `openai/gpt-oss-120b` | `npm run check:llm` lists valid ids |
| `LLM_MAX_TOKENS` | `4000` | Keep ≤4000 on the Groq free tier — it counts toward the 8000/min limit |
| `BROWSER_CHANNEL` | `chrome` | `chrome`, `msedge` or `chromium` |
| `BROWSER_HEADLESS` | `true` | Set `false` to **watch the tests run** |
| `SCAN_SETTLE_TIMEOUT_MS` | `15000` | How long to wait for a client-rendered app to paint |
| `RETRY_FAILED_ONCE` | `true` | The reproducibility rerun. Turning it off increases false bugs |
| `DESTRUCTIVE_KEYWORDS` | delete, pay, send… | Blocked unless explicitly allowed on the run |
| `PUBLIC_API_URL` | `http://localhost:4000` | Absolute base for screenshot links in exported reports |

</details>

---

## ⏱️ Try it in 60 seconds

Use a public practice site — nothing can break:

| Field | Value |
|---|---|
| URL | `https://the-internet.herokuapp.com/login` |
| Username | `tomsmith` |
| Password | `SuperSecretPassword!` |
| Requirements | `Logging in with valid credentials shows "You logged into a secure area".`<br>`A wrong password shows an error message and stays on /login.` |

Leave the default checks ticked, add the credentials, tick the two **Login** checks, and press go.

**Verified result: 8 tests generated, 6 pass, 2 fail.** Both failures are correct — the practice site loads a third-party analytics beacon that fails DNS, so `no console errors` and `no broken API calls` legitimately fail. The AI classifies it as an **environment issue**, not a bug in the app.

---

## 📊 Why you can trust the results

Most AI testing tools drown you in false alarms. Three design decisions stop that:

**1. The AI may only use what the browser actually found.** It gets a list of the real fields and buttons. It cannot invent a "Sign in" button that doesn't exist.

**2. The AI may only assert what you wrote.** No guessing that login should land on `/dashboard`. A guess that's wrong is a fake bug filed against working code.

**3. A failure is not a bug until a human says so.** Five different causes look identical from the outside:

```
FAIL
 ├─ PRODUCT BUG        the app is genuinely broken
 ├─ TEST DEFECT        the generated locator was wrong
 ├─ ENVIRONMENT ISSUE  site down, cert expired, third-party outage
 ├─ TEST DATA ISSUE    the test user was already consumed
 └─ FLAKY              timing, not reproducible
```

Every failure is re-run once in a clean browser first. The AI then suggests which of the five it is, with a confidence and the evidence it used — and a person confirms.

> **Measured on real sites:** every failure found so far was correctly identified as **not** a bug in the code — third-party outages and mistakes in the AI's own tests. Zero false bug reports filed.

---

## 🏗️ How it works

```
Next.js dashboard  ──HTTP──►  NestJS API  ──►  SQLite
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              ▼
              Groq / OpenAI   Chrome via     Policy engine
              (writes tests)  Playwright     (blocks unsafe
                              (runs tests)    steps)
```

| Phase | What happens | Status |
|---|---|---|
| 1 | Chrome opens the page, waits for it to render, lists every field/button/link | `SCANNING` |
| 2 | AI turns checks + requirements + that list into structured JSON | `PLANNING` |
| 3 | Policy engine validates every step against an allow-list | — |
| 4 | **You approve or edit** | `AWAITING_APPROVAL` |
| 5 | Chrome runs each test; assertions decide PASS/FAIL | `RUNNING` |
| 6 | Failures re-run once, then become findings with an AI suggestion | `COMPLETED` |

Deep detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · Endpoint reference: **[docs/API.md](docs/API.md)**

---

## 🔐 Safety

Website content is untrusted input — a page can contain text trying to steer the AI. Four layers:

1. **The AI has no browser access.** Its output is data in the backend, not commands.
2. **Schema validation** — wrong shape or unknown action is rejected.
3. **The policy engine** — per step: action allow-list, same-origin navigation only, no destructive keywords (delete/pay/send) unless explicitly enabled, SSRF blocking, and a case with **zero assertions is rejected** because it could never fail.
4. **The human gate** — nothing runs unapproved. Your edits go through layer 3 too.

Every rejection is shown in the UI. Nothing is silently dropped.

### Credentials never reach the AI

Test passwords are encrypted with **AES-256-GCM**. The AI only ever writes `test_email` / `test_password` references; the browser swaps in the real value at typing time, and secrets are stripped from every stored log, error message and URL.

---

## 🛠️ Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 15, TypeScript | Dashboard and report viewer |
| Backend | NestJS 11, TypeScript | Same language as Playwright — no Python↔Node bridge |
| Browser | Playwright driving **real Chrome** | Closest to what users run; falls back to Chromium |
| Database | SQLite + Prisma | Zero install for the MVP. [Postgres schema ready](docs/schema.postgres.prisma) |
| AI | Groq / any OpenAI-compatible API | Free tier; one env var switches provider |
| Auth | JWT + scrypt | No native dependency; every action attributed to a person |
| PDF | Chrome print-to-PDF | No extra library — Chrome is already here |

Playwright needs **no API key** — it's a library, not a service. The LLM key is the only secret in the project.

---

## 📁 Project structure

```
├── backend/                       NestJS API + Playwright worker
│   ├── prisma/schema.prisma       the data model
│   ├── scripts/                   check:llm, check:browser, set:owner
│   └── src/
│       ├── auth/                  accounts, JWT, scrypt, global guard
│       ├── llm/                   THE BRAIN — prompts, JSON schemas, provider
│       ├── browser/               THE HANDS — scanner, locators, executor
│       ├── policy/                THE SAFETY GATE
│       ├── runs/                  run-pipeline.service.ts = the whole flow
│       ├── findings/              triage: confirm / reject / reopen
│       ├── reports/               bug report → Markdown / HTML / PDF
│       ├── tickets/               assignment, lifecycle, Jira link
│       └── common/                the action/assertion contract, check catalogue
│
├── frontend/                      Next.js dashboard
│   ├── app/                       dashboard, runs/new, runs/[id], findings, tickets
│   ├── components/                RunForm, CheckPicker, TestCaseCard, FindingCard…
│   └── lib/api.ts                 the only file that calls the backend
│
└── docs/                          ARCHITECTURE.md, API.md, screenshots/
```

The **contract** lives in one file — [`backend/src/common/test-plan.types.ts`](backend/src/common/test-plan.types.ts). The AI's schema, the policy engine and the executor all import from it, so they can never drift apart.

---

## 🔌 API at a glance

```http
POST /api/auth/register              first account becomes OWNER
POST /api/runs                       url + checks + requirements → starts everything
GET  /api/runs/:id                   everything the run page needs, one call
POST /api/runs/:id/execute           run the approved tests
POST /api/test-cases/:id/approve     the human gate
POST /api/findings/:id/triage        the human verdict → mints BUG-001
GET  /api/findings/:id/report/pdf    BUG-001.pdf
POST /api/findings/:id/tickets       create TICKET-001 from a confirmed bug
POST /api/tickets/:id/retest         the Ready-for-Retest handoff
```

Full reference with request/response examples: **[docs/API.md](docs/API.md)**

---

## 🚧 MVP limitations

Being upfront is more useful than a long feature list:

| Not built | Why it matters |
|---|---|
| **Session reuse** | Every test signs in from scratch, so testing deep inside an app is slow. **Biggest next unlock.** |
| **Multiple URLs per run** | One page per run today. 5 pages = 5 runs. |
| Visual / pixel comparison | It tests whether things **work**, not whether they **look right**. No Figma comparison. |
| Firefox, Safari, mobile | Chrome only |
| Live Jira API sync | You paste the issue key and URL; it doesn't create the issue for you |
| File upload, iframes, popups | — |
| Email reports, scheduled runs, CI | — |
| Automatic test healing | **Deliberately excluded** — a test that edits itself until it passes silently deletes the assertion that was catching the bug |

### Roadmap, in order

1. **Session reuse** — log in once, reuse cookies for every later test
2. **Multiple URLs per run** — paste 5 pages, get one suite
3. **Visual regression** — approve a screenshot baseline, flag pixel changes
4. **Live Jira connector** — create the issue via API with an idempotency key
5. **Scheduled runs + CI** — nightly, and on every deploy

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` / port stuck | `.\kill-ports.ps1` |
| Header says **backend offline** | `cd backend && npm run start:dev` |
| Boot fails listing env problems | Fix exactly those lines in `backend/.env` |
| `401` from the LLM | Wrong `LLM_API_KEY` → `npm run check:llm` |
| `404 model not found` | Wrong `LLM_MODEL` → `npm run check:llm` and copy a listed id |
| `413 Request too large` | Groq free tier is 8000 tokens/min **and counts `LLM_MAX_TOKENS`**. Keep it ≤4000. |
| Scan found 0 elements, screenshot shows **"Loading…"** | Client-rendered app painting late → raise `SCAN_SETTLE_TIMEOUT_MS` |
| Lots of `LOCATOR_NOT_FOUND` | Open **Details → What the AI could see**. If the label is listed, raise `BROWSER_ACTION_TIMEOUT_MS`; if not, edit the test's target |
| `EPERM … query_engine-windows.dll` | The dev server holds the file — `.\kill-ports.ps1`, then `npx prisma generate` |

---

## 🐘 Moving to PostgreSQL

SQLite keeps the MVP install-free. Everything SQLite-specific is isolated in two files, so the switch is mechanical:

1. `docker compose up -d`
2. Swap `backend/prisma/schema.prisma` for [`docs/schema.postgres.prisma`](docs/schema.postgres.prisma)
3. Set `DATABASE_URL` to the Postgres URL
4. `rm -rf prisma/migrations && npx prisma migrate dev --name init`
5. Delete `src/common/db-json.ts` and `src/common/hydrate.ts`; the compiler points at the ~20 call sites

**No API or frontend changes** — the response payloads are already identical.

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The pipeline file by file, and why each decision was made |
| [docs/API.md](docs/API.md) | Every endpoint with request/response examples |
| [backend/.env.example](backend/.env.example) | Every setting, annotated |
| [docs/schema.postgres.prisma](docs/schema.postgres.prisma) | The PostgreSQL data model |

---

<div align="center">

**The honest promise**

> Give it an authorised page and say what should work.
> It proposes reviewable tests, runs them in Chrome, collects real evidence,
> and helps your team turn failures into actionable bug reports.

Not *"enter any URL and AI finds every bug."* That claim doesn't survive contact with a real app.

</div>
