<div align="center">

# AI Testing Platform

**Paste a URL. Tick what to check. Get real browser tests across your whole app, run in Chrome, with bug reports.**

No test-writing skills needed. A human approves everything before it runs.

[![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![Playwright](https://img.shields.io/badge/Playwright-Chrome-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![Prisma](https://img.shields.io/badge/Prisma-MongoDB-2D3748?logo=prisma&logoColor=white)](https://prisma.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
![Status](https://img.shields.io/badge/status-MVP-blue)

</div>

---

## 🚀 What it is

A web app that **tests other websites for you**.

You give it a URL and tick what should be checked. It opens the page in **real Google Chrome**, reads what's on it, asks an AI to write the test cases, and waits for you to approve them. Then it runs them and tells you what broke — with a screenshot, the console errors, and the failed API calls.

Tick **Test the whole app** and it does that for every screen it can reach from that URL, not just the one you pasted — one run, one approval, one bug list.

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
| ✅ **Whole-app runs** | Crawls your app and tests every page it finds — one run, one approval gate |
| ✅ **Tick-box checks** | 13 ready-made checks — no test writing required |
| ✅ **AI test generation** | Plain-English requirements → structured test cases |
| ✅ **Real Chrome execution** | Not a headless simulation; falls back to Chromium |
| ✅ **Human approval gate** | Nothing runs until a person approves it |
| ✅ **Deterministic PASS/FAIL** | Assertions decide, never the AI |
| ✅ **Screenshots + traces** | Full-page capture and frame-by-frame replay |
| ✅ **Console + API errors** | `POST /api/login → 401` captured automatically |
| ✅ **Reproducibility check** | Every failure re-runs once in a clean browser |
| ✅ **Signs in first** | One sign-in, reused by every test — pages behind a login are testable |
| ✅ **Wording review** | Typos, grammar and leftover placeholder text in the page copy |
| ✅ **Design vs Figma** | Sizes, radii, type, weights, **colours**, **icon sizes** and **spacing** checked against a Figma frame |
| ✅ **AI failure triage** | Whose fault (bug / test / environment) **and** what kind (UI / data / content / technical) |
| ✅ **Bug reports** | `BUG-001` as PDF, Markdown or HTML |
| ✅ **Ticket workflow** | Assignee, lifecycle, comments, retest |
| ✅ **Auto-files in Jira / ClickUp / Linear** | Real issues via API, with the screenshot and trace attached |
| ✅ **Email notifications** | Sign-in alerts, run summaries, assignment mail |
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
| **Data & loading** | Loading finishes properly | No spinner or skeleton is left on screen |
| | Server data is displayed | A value the API returned actually appears on the page |

### 🌐 Testing the whole app, not one page

Tick **Test the whole app** and the platform follows the links from your entry URL to work out
what your app is made of, then scans, plans and runs every check you ticked against **each page
it finds**.

```
Entry     https://staging.yoursite.com/dashboard
Found     /dashboard  /employees  /employees/new  /attendance  /reports  /settings  …
Result    1 run · 1 approval gate · 1 findings list
```

It is a bounded crawler, not a web spider, because every extra page costs a browser scan and an
AI call:

| Rule | Why |
|---|---|
| **Same origin only** | You authorised one site. An outbound link points an automated browser at somebody who never consented. |
| **Breadth-first** | The screens a user reaches in one click come before ones buried four levels down, so a small budget is spent where it matters. |
| **Read-only** | It reads `href` attributes. It never clicks, never submits a form, never follows a link that looks destructive. |
| **Never signs out** | The crawl reuses your session. Following "Log out" would kill it, and every page after that would be the login screen — with the run then blaming your app for it. |
| **Deduplicated** | `/users`, `/users/`, `/users#top` and `/users?utm_source=x` are one page, not four. |
| **Budgeted** | `Maximum pages` and link depth are yours to set, and clamped server-side. |

**One dead page does not kill the run.** On a twelve-page app a slow route or a 500 is normal, so
each page carries its own status and its own reason:

```
Pages          12 discovered · 9 tests written · 2 could not be read · 1 skipped

  /reports        Could not read — the page never rendered any interactive content within 15000ms
  /settings/api   No tests — the page exposed no labelled inputs, buttons or links
  /audit-log      Skipped — the run reached its 60-case limit before this page was planned
```

That count is shown on the **Tests** tab too, next to the approve button. A suite that reports
itself green while a quarter of the app was never opened is the one dishonest thing whole-app
testing could do, so it is stated where it cannot be missed.

**Login checks only go to login pages.** You tick "Login works" once, meaning *check my app's
login*. Handing that to all twelve pages would produce eleven cases hunting for a password field
on the dashboard, each failing with `LOCATOR_NOT_FOUND` — eleven false test defects. So a page
gets the Login group only if it actually has a password field, or a URL or title that says login.

**Cost:** one page scan and one AI call per page, run sequentially — a free-tier key is
rate-limited per minute, and firing twelve planning calls at once fails eleven of them. A bigger
page budget makes a run take longer; it does not make it fail.

### 🔑 Testing pages behind a login

Give a **sign-in URL** alongside the test credentials and the platform signs in **once**, before it reads anything, then reuses that session for every page and every test.

This is what makes an app's interior testable — and *discoverable*. Without it a protected URL simply redirects to `/login`, the scan describes the login page while believing it's the dashboard, and every generated test asserts against a page it never saw. A whole-app run signed out is worse still: a protected app is a login form with no links on it, so the crawl finds exactly one page.

```
Target   https://app.example.com/employee/attendance
Sign-in  https://app.example.com/login
```

The sign-in is **not** a test case: it's deterministic, it can't be approved away, and it never appears in the results as a pass or a fail. The captured session is encrypted at rest, re-established if it goes stale, and wiped when the run finishes.

### ✍️ Wording review — typos, grammar, leftover placeholder text

A second pass reads the page's own copy and flags misspellings, broken grammar, mismatched labels, inconsistent capitalisation and shipped `Lorem ipsum`.

**Advisory only.** A spell-check over real product copy will always be tempted by brand names and jargon, and one wrong flag costs more trust than ten missed typos. So these appear in their own **Wording** tab, never as a failure. You click **Raise bug** to turn one into a real defect, or **Not an issue** to dismiss it — and the dismissal sticks, so your product names stop coming back.

Measured against a page seeded with 4 real errors and 10 decoys (`OTTO SEO`, `Kubernetes`, `gRPC`, `OAuth2`, Spanish text): **4/4 found, 0/10 false positives.**

### 🎨 Design comparison — does the page match Figma?

Paste a **Figma frame URL** and the platform reads the design as a *specification* — the button and input heights, corner radii, type scale, weights, colour palettes, icon sizes and spacing scale it permits — then checks the live page for conformance.

**This check stays on ONE page, on purpose — even when the run tests your whole app.** A Figma
frame *is* one screen's design. You point at the login frame because you want the login page
checked; running that same frame against twelve pages would report every button on the dashboard
as violating the login design — a wall of confident, wrong findings. So in whole-app mode you get
one extra field, *"Which page is this design for?"*, and everything else keeps going wide.

It deliberately does **not** try to pair each Figma layer with one page element. In a real design system the layer is called `Color=Brand, Size=base, State=Initial` while the live button says `Pricing & FAQ`; there is nothing to pair on, and an app page rarely mirrors a design frame anyway.

```
Design read: heights 32/36/40/44/48/52px, radii 12px, type 12/14/16px,
             weights 400/500/700, 31 colours, icons 16/20/24px, spacing 4/8/12/16/24px
612 values matched · 11 deviations across 284 elements

  button height     "Pricing & FAQ"   page 38px      →  design 36px
  corner radius     "Log in"          page 10px      →  design 16px
  font size         "Log in"          page 15px      →  design 14px
  font weight       "Get started"     page 600       →  design 500
  text colour       "Read the docs"   page #6B7280   →  design #4B5563
  background colour "Sign up"         page #3C82F7   →  design #3B82F6
  icon size         <svg> 22x22       page 22px      →  design 24px
  gap               div.flex.gap-4    page 15px      →  design 16px
```

**Near-misses only.** Something 2px off a design value is almost certainly meant to be that value; something 20px off is a component the design doesn't cover, and stays silent. Flagging everything would produce a wall nobody reads.

**Eleven properties, in five families** — the UI groups them so you can read one class at a
time, or dismiss a whole class:

| Family | Checked |
|---|---|
| **Sizes** | button heights · input/control heights · corner radii |
| **Type** | font sizes · font families · font weights |
| **Colour** | text colour · background colour · border colour |
| **Spacing** | padding · flex/grid gaps |
| **Icons** | icon box size |

Colour is compared by *weighted perceptual distance*, not string equality — the eye is far more
sensitive to green than to blue, and an unweighted comparison would call two obviously different
blues "close" while flagging two indistinguishable greys. It catches the two mistakes that
actually happen: a hardcoded hex instead of the token, and the wrong step of the right ramp.

**Still not checked, deliberately:** element positions, arbitrary widths, and pixel diffing. A
design system does not constrain how wide a card is — that is the page's layout, not the design's
rule — so flagging a width would be inventing a requirement. Icon and control *dimensions* are
checked precisely because those genuinely are rules (16/20/24 and nothing between).

Requires `FIGMA_TOKEN` in `backend/.env` with the **`file_content:read`** scope. Without it, every other check keeps working.

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
| **Whose fault** | `PRODUCT_BUG` · `TEST_DEFECT` · `ENVIRONMENT_ISSUE` · `TEST_DATA_ISSUE` · `FLAKY` |
| **What kind** | `FUNCTIONAL` · `TECHNICAL` · `DATA` · `CONTENT` · `UI_VISUAL` · `LOADING` |

Those last two are independent axes, and a triager needs both. A defect can be `PRODUCT_BUG` + `UI_VISUAL` (real, and a layout problem) or `PRODUCT_BUG` + `DATA` (real, and the values are wrong) — the pair is what routes it to the right person.

---

## 🎫 Filing bugs in Jira, ClickUp or Linear

A confirmed defect becomes a **real issue in your tracker**, created through the API — not a link
you paste by hand. The bug report goes in as the description, and the **failure screenshot and
Playwright trace are uploaded as attachments**, so a developer never has to open this tool.

```
Test fails
   │
   ├─ re-run once in a clean browser        (is it even reproducible?)
   │
   ├─ AI suggests a cause, labelled as a suggestion
   │
   └─ A HUMAN confirms it is a real defect  ◄── the gate
          │
          ├─ BUG-007 assigned  ──►  TICKET-004 created
          │
          └─ filed as  QA-142 in Jira   (or a ClickUp task, or ENG-88 in Linear)
                 with the report, the screenshot and the trace
```

### Why it does not file on failure

This is the one place this product deliberately behaves differently from the tools it competes
with. A failing test has **five** possible causes and only one of them is a bug:

```
FAIL
 ├─ PRODUCT BUG        the app is genuinely broken      ◄── the only one worth filing
 ├─ TEST DEFECT        the AI's generated locator was wrong
 ├─ ENVIRONMENT ISSUE  site down, cert expired, third-party outage
 ├─ TEST DATA ISSUE    the test user was already consumed
 └─ FLAKY              timing, not reproducible
```

A tool that files automatically on failure spends its first week filling your backlog with its own
mistakes — and after that, nobody trusts anything it files. So the **trigger is a human
confirming the finding**. After that point nothing else is manual: with `TRACKER_AUTO_PUSH=true`
the issue is created the moment the bug is confirmed, no extra click.

### Setting it up

Pick one provider in `backend/.env`. Restart the backend, then press **Test** on the Integrations
panel (Account page) — it checks the credentials without filing a junk issue into your real
backlog.

<details>
<summary><b>Jira Cloud</b></summary>

```ini
TRACKER_PROVIDER=jira
TRACKER_AUTO_PUSH=true

JIRA_BASE_URL=https://yourteam.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=ATATT...
JIRA_PROJECT_KEY=QA
JIRA_ISSUE_TYPE=Bug
```

`JIRA_API_TOKEN` is an **API token, not your password** — Atlassian always rejects the password
for API calls. Create one at
[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens),
and make sure `JIRA_EMAIL` is the account it belongs to.

Two Jira quirks are handled for you: the description is converted to **ADF** (Jira's REST v3 takes
structured JSON, not a string — send a string and the whole issue is rejected with a 400 that
names no field), and if your project has no Priority field on its create screen the issue is
re-filed without it rather than failing.
</details>

<details>
<summary><b>ClickUp</b></summary>

```ini
TRACKER_PROVIDER=clickup
TRACKER_AUTO_PUSH=true

CLICKUP_API_TOKEN=pk_12345_ABCDEF
CLICKUP_LIST_ID=901234567
CLICKUP_STATUS=to do          # optional; blank = the list default
```

`CLICKUP_LIST_ID` is the numeric **List** id — the trailing number in a list URL like
`app.clickup.com/9012345/v/li/901234567`. Not a Space, Folder or task id; that mistake produces a
404 that says nothing useful.

Token from **ClickUp → Settings → Apps**. ClickUp wants the bare token in the header with **no
`Bearer ` prefix**, and the description must go in `markdown_description` or it arrives with its
`##` and `|` characters visible — both handled here.
</details>

<details>
<summary><b>Linear</b></summary>

```ini
TRACKER_PROVIDER=linear
TRACKER_AUTO_PUSH=true

LINEAR_API_KEY=lin_api_...
LINEAR_TEAM=ENG               # the team key, or its UUID
```

Key from **Linear → Settings → API**. `LINEAR_TEAM` takes the key you actually say out loud
("ENG") and looks up the UUID the API wants.

One limitation, stated on the ticket rather than hidden: Linear's public API has **no file
upload**, so the screenshot and trace are *linked* rather than attached. Those links only work for
people who can reach `PUBLIC_API_URL`.
</details>

**Idempotent.** A double-click, an impatient retry, or a timeout followed by a retry cannot create
two issues for one bug — an idempotency key is claimed before the call and checked on entry.
Duplicated bug reports are the fastest way for a team to stop trusting an automated reporter.

**A failed push is visible and retryable.** It is recorded on the ticket with the reason, and the
button becomes a retry. A confirmed bug that quietly never reached the developers is the worst
outcome this feature has, so it is never swallowed.

Not using any of the three? **Link an existing issue** still works — paste a key and URL, exactly
as before.

---

## 📧 Email notifications

Three notifications, three different audiences. Every one is **fire-and-forget**: a mail outage
can never fail a sign-in or lose a test result.

| When | Who gets it | What it says |
|---|---|---|
| **Someone signs in** | that account | A security alert with the **time, IP address and device**, and what to do if it was not them |
| **A run or website audit finishes** | whoever started it | Pass/fail counts, wording and design totals, and — importantly — **how many pages could not be tested at all** |
| **A bug is confirmed** | the assignee | `BUG-007` is yours, with the tracker link. Falls back to the reporter when nobody is assigned |

```ini
MAIL_ENABLED=true
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=you@gmail.com
MAIL_PASSWORD=abcd efgh ijkl mnop      # a 16-char App Password, NOT your password
MAIL_FROM=AI QA <you@gmail.com>

# Every link in every email is built from this. localhost produces emails
# that only work on your own machine.
APP_PUBLIC_URL=https://qa.yourcompany.com

MAIL_ON_LOGIN=true
MAIL_ON_RUN_FINISHED=true
MAIL_ON_BUG_FILED=true
```

**Gmail:** your normal Google password is always rejected. Turn on 2FA, then generate a
16-character App Password at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). `MAIL_SECURE` is
derived from the port (465 = implicit TLS, 587 = STARTTLS), so you rarely need to set it.

Press **Test** on the Integrations panel to check the credentials — it opens an SMTP connection
and hangs up, so it cannot put a test message in anyone's inbox.

The run summary states the honest caveat rather than only the good news: if three of twelve pages
could not be read, the email says so, because "24 passed" over a quarter-untested app is
technically true and actively misleading.

---

## 🏁 Getting started

**Requirements:** Node 20+, and Google Chrome installed (falls back to bundled Chromium).

```bash
# 0. Database — a single-node MongoDB replica set on :27017
docker compose up -d

# 1. Backend
cd backend
cp .env.example .env          # then add your LLM key (see below)
npm install
npx prisma db push            # Mongo has no migrations — push the schema
npx playwright install chromium
npm run start:dev             # http://localhost:4000

# 2. Frontend  (second terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Open <http://localhost:3000>, create an account (**the first account becomes the owner**), and press **Test a page**.

### 🍃 About the database

The platform runs on **MongoDB**. `docker compose up -d` starts one as a **single-node replica
set** — that is not optional decoration: MongoDB only offers multi-document transactions and
change streams on a replica set, and Prisma requires one. A plain `mongod` will reject writes.

**No Docker on Windows?** Install it natively instead — this repo ships the one script that needs
admin rights:

```powershell
winget install MongoDB.Server
winget install MongoDB.Shell

# Adds "replication: replSetName: rs0" to mongod.cfg and restarts the service.
# Run this from an elevated PowerShell:
powershell -ExecutionPolicy Bypass -File .\scripts\setup-mongo-replicaset.ps1

# Then initiate the set (no admin needed):
mongosh --eval "rs.initiate()"
```

Or point `DATABASE_URL` at MongoDB Atlas — a free tier cluster works, and Atlas is a replica set
already:

```ini
DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/aitest?retryWrites=true&w=majority
```

Mongo has no migration files. After editing `prisma/schema.prisma`, run `npx prisma db push`.

### 🔑 The two values you must set

`backend/.env`:

```ini
# Free key from https://console.groq.com  →  API Keys
LLM_API_KEY=gsk_...

# Any 32 random bytes:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=...
```

Optional, for the design comparison only — everything else works without it:

```ini
# Figma > Settings > Security > Generate new token
# Tick ONLY the "file_content:read" scope. Never grant a :write scope:
# this tool reads a design and must never be able to modify one.
FIGMA_TOKEN=figd_...
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
| `npx prisma db push` | Apply a schema change (Mongo's equivalent of a migration) |

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
| `MAX_TEST_CASES_PER_RUN` | `60` | Ceiling on the whole plan, across every page |
| `MAX_TEST_CASES_PER_PAGE` | `8` | Per-page allowance. 8 is what a single-page run always got |
| `CRAWL_DEFAULT_MAX_PAGES` | `10` | Default page budget for a whole-app run |
| `CRAWL_DEFAULT_MAX_DEPTH` | `2` | Default link depth from the entry URL |
| `CRAWL_MAX_PAGES_HARD` | `50` | The ceiling the API clamps to, whatever a request asks for |
| `PUBLIC_API_URL` | `http://localhost:4000` | Absolute base for screenshot links in exported reports |
| `FIGMA_TOKEN` | — | Optional. Enables design comparison. Scope: `file_content:read` only |
| `FIGMA_TIMEOUT_MS` | `20000` | A design-system file can be large; raise it if reads time out |

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
Next.js dashboard  ──HTTP──►  NestJS API  ──►  MongoDB
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              ▼
              Groq / OpenAI   Chrome via     Policy engine
              (writes tests)  Playwright     (blocks unsafe
                              (runs tests)    steps)
```

| Phase | What happens | Status |
|---|---|---|
| 0 | Sign in once, if the app is behind a login | `SCANNING` |
| 1 | Chrome follows the links from your URL to find the app's pages | `SCANNING` |
| 2 | **Per page:** Chrome opens it, waits for it to render, lists every field/button/link | `SCANNING` |
| 3 | **Per page:** AI turns checks + requirements + that list into structured JSON | `PLANNING` |
| 4 | Policy engine validates every step against an allow-list | — |
| 5 | **You approve or edit** — once, for the whole app | `AWAITING_APPROVAL` |
| 6 | Chrome runs each test **starting at its own page**; assertions decide PASS/FAIL | `RUNNING` |
| 7 | Failures re-run once, then become findings with an AI suggestion | `COMPLETED` |

A single-page run is the same pipeline with one page in it — which is why nothing downstream
carries an `if (wholeApp)` branch.

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
| Database | MongoDB + Prisma | Native `Json` and arrays, so the AI's steps and assertions are stored as documents rather than encoded text |
| AI | Groq / any OpenAI-compatible API | Free tier; one env var switches provider |
| Auth | JWT + scrypt | No native dependency; every action attributed to a person |
| PDF | Chrome print-to-PDF | No extra library — Chrome is already here |
| Trackers | Jira REST v3 · ClickUp v2 · Linear GraphQL | One `TrackerProvider` interface; adding a fourth is one file |
| Email | Nodemailer over SMTP | Works with Gmail, Office 365 or your own relay — no vendor lock-in |

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
│       ├── browser/               THE HANDS — crawler, scanner, locators, executor
│       ├── policy/                THE SAFETY GATE
│       ├── runs/                  run-pipeline.service.ts = the whole flow
│       ├── findings/              triage: confirm / reject / reopen
│       ├── reports/               bug report → Markdown / HTML / PDF
│       ├── tickets/               assignment, lifecycle, external filing
│       ├── trackers/              Jira / ClickUp / Linear providers
│       ├── mail/                  notifications + HTML email templates
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
GET  /api/runs/:id/pages/:pageId     one page's snapshot + its advisory lists
POST /api/runs/:id/execute           run the approved tests
POST /api/test-cases/:id/approve     the human gate
POST /api/findings/:id/triage        the human verdict → mints BUG-001
POST /api/content-issues/:id/promote a typo → a real bug, after you say so
POST /api/design-issues/:id/promote  a design mismatch → a real bug, after you say so
GET  /api/findings/:id/report/pdf    BUG-001.pdf
POST /api/findings/:id/tickets       create TICKET-001 from a confirmed bug
POST /api/tickets/:id/retest         the Ready-for-Retest handoff
POST /api/tickets/:id/push           file it in Jira / ClickUp / Linear (idempotent)
GET  /api/trackers/status            which tracker is connected, if any
POST /api/trackers/verify            check the credentials — files nothing
GET  /api/integrations               tracker + email status (never any secret)
POST /api/integrations/mail/verify   check SMTP — sends nothing
```

Full reference with request/response examples: **[docs/API.md](docs/API.md)**

---

## 🚧 MVP limitations

Being upfront is more useful than a long feature list:

| Not built | Why it matters |
|---|---|
| **Pages only reachable by clicking** | The crawler reads `href` attributes. A screen behind a JavaScript-only button is not discovered — add it as its own run. |
| **Data correctness** | It verifies a value the API returned is *displayed*, not that the value is *right*. There is no oracle for that. |
| Pixel / visual regression | Design comparison checks sizes, type, colours, icons and spacing — not positions, arbitrary widths, or a screenshot diff |
| **Design comparison across pages** | One Figma frame per run, against one page. A frame is one screen's design; see above. |
| Firefox, Safari, mobile | Chrome only |
| Two-way tracker sync | It **creates** the issue; it does not yet read status changes back from Jira/ClickUp |
| File upload, iframes, popups | — |
| Email reports, scheduled runs, CI | — |
| Automatic test healing | **Deliberately excluded** — a test that edits itself until it passes silently deletes the assertion that was catching the bug |

### Roadmap, in order

1. **Two-way tracker sync** — read status back, so closing in Jira closes here
2. **Sitemap and route-manifest discovery** — read `sitemap.xml` and Next.js routes instead of only following links
3. **Visual regression** — approve a screenshot baseline, flag pixel changes
4. **Parallel page planning** — one worker per page, once a paid LLM tier makes it safe
5. **Slack notifications** — the same three events, in a channel
6. **Scheduled runs + CI** — nightly, and on every deploy

Shipped since the first cut: **whole-app runs**, **MongoDB**, **Jira / ClickUp / Linear auto-filing**, **email notifications**, **colour / icon / spacing / weight design checks**, **session reuse**, **wording review**, **design-vs-Figma comparison**, **stuck-loader** and **server-data** checks, and the **what-kind** bug category.

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
| `Server selection timeout` on boot | MongoDB is not running → `docker compose up -d` |
| Writes fail with `not primary` | Your mongod is standalone, not a replica set. Use `docker compose up -d`, or Atlas |
| A whole-app run found only 1 page | It is behind a login and no sign-in URL was given — signed out, the app is a login form with no links |
| A whole-app run is slow | One AI call per page, run sequentially. Lower **Maximum pages** |
| Run says "2 of 6" and COMPLETED | Was a bug (an index rejected the 2nd finding, killing the loop). Fixed — run `npx prisma db push` if you are on an older database |
| Push button missing on a ticket | No tracker configured. Set `TRACKER_PROVIDER` and restart |
| Jira `400` on push | Issue type or a required custom field. Check `JIRA_ISSUE_TYPE` exists in that project |
| Jira `401` | You used your password. It must be an API token, with `JIRA_EMAIL` as its owner |
| ClickUp `404` | `CLICKUP_LIST_ID` is not a **List** id. Take the trailing number from a list URL |
| No emails arriving | Press **Test** on Account → Integrations. For Gmail you need an App Password, not your password |
| Email links go to localhost | Set `APP_PUBLIC_URL` to the address your team opens |

---

## 🍃 Notes on the MongoDB model

Two things the old SQLite build had to fake are native here, and both are now simply gone:

| Was | Now |
|---|---|
| `packJson()` / `unpackJson()` — JSON stored as text | `Json` columns. Steps, assertions, step timelines, the page snapshot and the AI's evidence are real documents |
| `packTags()` / `unpackTags()` — comma-separated strings | `String[]`. Tags, checks and ticket labels are real arrays |
| `src/common/hydrate.ts` — reassembling every response | Deleted. What the driver returns *is* the response shape |

Three deliberate choices worth knowing:

- **IDs are UUID strings, not ObjectIds** (`@id @map("_id") @default(uuid())`). It means no field
  in the codebase needs `@db.ObjectId`, and no URL, log line or bug report changed shape.
- **Statuses stay `String` columns**, with the allowed values as const objects in
  `src/common/enums.ts`. Mongo supports Prisma enums, but a status is written from about forty
  places and the const objects already give the same exhaustiveness checking.
- **`@unique` only ever on a required field.** Prisma creates Mongo unique indexes *non-sparse*,
  and Mongo indexes a **missing** field as `null` — so two documents that both omit an optional
  unique field collide. That is not theoretical: it made the *second finding ever created* fail.
  Optional fields get a plain `@@index`, and uniqueness is enforced in the services. Full
  explanation in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#never-put-unique-on-an-optional-field).

One more consequence to remember: `prisma.$transaction([...])` needs a replica set, so `replan()`
is written as sequential awaits instead. Each step is independently safe.

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The pipeline file by file, and why each decision was made |
| [docs/API.md](docs/API.md) | Every endpoint with request/response examples |
| [backend/.env.example](backend/.env.example) | Every setting, annotated |
| [backend/prisma/schema.prisma](backend/prisma/schema.prisma) | The MongoDB data model |

---

<div align="center">

**The honest promise**

> Give it an authorised app and say what should work.
> It finds your pages, proposes reviewable tests for each, runs them in Chrome,
> collects real evidence, and helps your team turn failures into actionable bug reports.

Not *"enter any URL and AI finds every bug."* That claim doesn't survive contact with a real app.

</div>
