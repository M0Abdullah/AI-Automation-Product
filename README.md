<div align="center">

# AI Testing Platform

**Paste a staging URL. Tick what to check. It tests your whole app in real Chrome and emails you everything that broke.**

No test-writing skills needed. No buttons to press while it works.

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

You give it a URL and tick what should be checked. It opens the page in **real Google Chrome**, reads what's on it, asks an AI to write the test cases, and runs them — no approval step, no waiting on you. Then it tells you what broke, with a screenshot, the console errors, and the failed API calls.

Tick **Test the whole app** and it does that for every screen it can reach from that URL, not just the one you pasted — one run, one list of what's broken.

**It does not file tickets.** A failed test has five possible causes and only one is a bug, so it reports *what* failed and *why* and leaves the judgement to you.

```
     You                    Chrome                 AI
      │                       │                     │
  paste URL ──────────────► reads the page          │
  tick checks                 │                     │
      │                  what's on it ───────────► writes tests
      │                       │                     │
      │                       │              ┌─ safety gate ──┐
      │                       │              │ every step     │
      │                       │              │ validated      │
      │                       │              │ before it runs │
      │                       │              └───────┬────────┘
      │                       │                      │
      │                  runs them ◄─────────────────┘
      │                       │
      │                  PASS / FAIL
      │                       │
      └───────────────────────┴──► EMAIL: what failed, and why
                                     screenshot · console · failed API calls
```

**Three parts, three jobs.** The AI decides *what* to test. The backend validates and stores. Chrome does the clicking and decides PASS/FAIL. The AI never touches the browser and never decides whether a test passed.

---

## 📸 Screenshots

### 1. Start a test — tick boxes, don't write code

Eleven ready-made checks that work on any page. Writing requirements is optional, for business rules only.

![Start a test](docs/screenshots/02-start-a-test.png)

### 2. The tests it wrote — visible while they run, nothing to approve

![Review tests](docs/screenshots/03-review-tests.png)

### 3. Results — plain English, one line per test

![Results](docs/screenshots/04-results.png)

### 4. Failures — the AI explains, you decide

Its opinion is labelled a suggestion. The screenshot of the moment it broke is right there.

![Failures](docs/screenshots/05-failures.png)

### 5. Dashboard — is the suite healthy, and what needs me today

![Dashboard](docs/screenshots/06-dashboard.png)

<details>
<summary>Sign-in screen</summary>

![Sign in](docs/screenshots/01-sign-in.png)

</details>

---

## ✨ Key features

| | |
|---|---|
| ✅ **Whole-app runs** | Crawls your app and tests every page it finds — one run, one list |
| ✅ **Tick-box checks** | 13 ready-made checks — no test writing required |
| ✅ **AI test generation** | Plain-English requirements → structured test cases |
| ✅ **Real Chrome execution** | Not a headless simulation; falls back to Chromium |
| ✅ **Starts on its own** | Paste a URL and it scans, plans and runs. No approval click |
| ✅ **Deterministic PASS/FAIL** | Assertions decide, never the AI |
| ✅ **Screenshots + traces** | Full-page capture and frame-by-frame replay |
| ✅ **Console + API errors** | `POST /api/login → 401` captured automatically |
| ✅ **Reproducibility check** | Every failure re-runs once in a clean browser |
| ✅ **Signs in first** | One sign-in, reused by every test — pages behind a login are testable |
| ✅ **Wording review** | Typos, grammar and leftover placeholder text in the page copy |
| ✅ **Design vs Figma** | Sizes, radii, type, weights, **colours**, **icon sizes** and **spacing** checked against a Figma frame |
| ✅ **AI failure triage** | Whose fault (bug / test / environment) **and** what kind (UI / data / content / technical) |
| ✅ **Email with the failures in it** | Not "3 failed" — the name, the page, the reason and the evidence for each |
| ✅ **Email when somebody joins** | The owners are told when an account is created |
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
Result    1 run · 1 findings list · 1 email
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

That count is shown on the **Tests** tab too. A suite that reports
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

The sign-in is **not** a test case: it's deterministic, and it never appears in the results as a pass or a fail. The captured session is encrypted at rest, re-established if it goes stale, and wiped when the run finishes.

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

## 📧 Email notifications

Three notifications, three different audiences. Every one is **fire-and-forget**: a mail outage
can never fail a sign-in or lose a test result.

| When | Who gets it | What it says |
|---|---|---|
| **Someone registers** | **the owners** | `Ali Khan (ali@x.com) created an account`, with the time, IP and device — the only signal that an account exists you did not create |
| **Someone signs in** | that account | A security alert with the **time, IP address and device**, and what to do if it was not them |
| **Testing starts** | whoever started it | `Testing has started on staging.yoursite.com` — how many pages were found, and roughly how long it will take. Sent after discovery, so it says something you could not already see |
| **The run finishes** | whoever started it | **The result.** Counts, then every failure by name with the page, the reason and the console/API evidence — and how many pages could not be tested at all |

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
MAIL_ON_USER_JOINED=true      # to the OWNERS, not to the person who joined
MAIL_ON_RUN_STARTED=true
MAIL_ON_RUN_FINISHED=true
```

**Gmail:** your normal Google password is always rejected. Turn on 2FA, then generate a
16-character App Password at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). `MAIL_SECURE` is
derived from the port (465 = implicit TLS, 587 = STARTTLS), so you rarely need to set it.

Press **Test** on the Integrations panel to check the credentials — it opens an SMTP connection
and hangs up, so it cannot put a test message in anyone's inbox.

### The finish email carries the failures, not just the counts

Because a run now goes from URL to results with no stop in between, this email is usually the
**first** thing you see about it. "3 failed" would force a login just to learn whether it can
wait, so each failure arrives spelled out:

```
What failed, and why
──────────────────────────────────────────────
✗ Login rejects a wrong password
  /login
  Expected the error message to be visible, but nothing appeared.
      console: Uncaught TypeError: r.validate is not a function
      POST /api/auth/login → 500

✗ Employee list shows data from the server
  /employees
  Expected at least one row, but the table was empty.
      GET /api/employees → 401
```

The reason comes from the **executor** — the assertion that did not hold — never from the AI's
triage guess. A guess does not belong in a summary somebody forwards to a developer.

It also states the honest caveat rather than only the good news: if three of twelve pages could
not be read, the email says so, because "24 passed" over a quarter-untested app is technically
true and actively misleading.

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
| `.\scripts\kill-ports.ps1` | Frees ports 3000/4000 and kills stray watch processes |
| `.\scripts\release.ps1 -Version x.y.z` | Checks, bumps and pushes. CI publishes the release — see [Releasing](#-releasing) |
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
| `PUBLIC_API_URL` | `http://localhost:4000` | Absolute base for screenshot links |
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
| 4 | Policy engine validates every step against an allow-list — **the gate** | — |
| 5 | Chrome runs each test **starting at its own page**; assertions decide PASS/FAIL | `RUNNING` |
| 6 | Failures re-run once, then become findings with an AI suggestion | `COMPLETED` |
| 7 | The email goes out with every failure and its reason | `COMPLETED` |

A single-page run is the same pipeline with one page in it — which is why nothing downstream
carries an `if (wholeApp)` branch.

Deep detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · Endpoint reference: **[docs/API.md](docs/API.md)**

---

## 🔐 Safety

Website content is untrusted input — a page can contain text trying to steer the AI. Three layers,
and **none of them is a person clicking approve**:

1. **The AI has no browser access.** Its output is data in the backend, not commands.
2. **Schema validation** — wrong shape or unknown action is rejected.
3. **The policy engine** — per step: action allow-list, same-origin navigation only, no destructive keywords (delete/pay/send) unless explicitly enabled on the run, SSRF blocking, and a case with **zero assertions is rejected** because it could never fail.

Every rejection is shown in the UI. Nothing is silently dropped.

> **Why there is no approval click.** It used to sit between layer 3 and execution, and it was the
> weakest layer of the four: the button that got pressed was *Approve all*, on forty cases nobody
> read. What it reliably added was delay — a run sat idle until somebody noticed it. The checks
> that actually stop a bad step run on every case whether or not anyone is watching.
>
> **Destructive actions are still opt-in.** A step touching `delete`, `pay` or `send` is rejected
> unless you tick *Allow destructive actions* when starting the run. That is the real gate, and it
> is a decision you make **before** the run, not a click during it.

### Credentials never reach the AI

Test passwords are encrypted with **AES-256-GCM**. The AI only ever writes `test_email` / `test_password` references; the browser swaps in the real value at typing time, and secrets are stripped from every stored log, error message and URL.

---

## 🛠️ Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 15, TypeScript | Dashboard and results viewer |
| Backend | NestJS 11, TypeScript | Same language as Playwright — no Python↔Node bridge |
| Browser | Playwright driving **real Chrome** | Closest to what users run; falls back to Chromium |
| Database | MongoDB + Prisma | Native `Json` and arrays, so the AI's steps and assertions are stored as documents rather than encoded text |
| AI | Groq / any OpenAI-compatible API | Free tier; one env var switches provider |
| Auth | JWT + scrypt | No native dependency; every action attributed to a person |
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
│       ├── mail/                  notifications + HTML email templates
│       └── common/                the action/assertion contract, check catalogue
│
├── frontend/                      Next.js dashboard
│   ├── app/                       dashboard, runs/new, runs/[id], findings
│   ├── components/                RunForm, CheckPicker, TestCaseCard, FindingCard…
│   └── lib/api.ts                 the only file that calls the backend
│
├── docs/                          ARCHITECTURE.md, API.md, screenshots/
├── scripts/                       repo-level ops: kill-ports, release, mongo setup
├── .github/workflows/ci.yml       build + secret scan, then release on a version bump
├── artifacts/                     run evidence at runtime — gitignored, not source
└── docker-compose.yml             the single-node MongoDB replica set
```

Two `scripts/` folders, deliberately: [`scripts/`](scripts/) holds PowerShell you run *on the
repo* (free the ports, cut a release, configure mongod), while
[`backend/scripts/`](backend/scripts/) holds TypeScript you run *through the app's own runtime*
(`npm run check:llm`, `check:browser`, `set:owner`) — those need the Nest config and Prisma client
loaded, so they live with the code they import.

The **contract** lives in one file — [`backend/src/common/test-plan.types.ts`](backend/src/common/test-plan.types.ts). The AI's schema, the policy engine and the executor all import from it, so they can never drift apart.

---

## 🔌 API at a glance

```http
POST /api/auth/register              first account becomes OWNER
POST /api/runs                       url + checks + requirements → starts everything
GET  /api/runs/:id                   everything the run page needs, one call
GET  /api/runs/:id/pages/:pageId     one page's snapshot + its advisory lists
POST /api/runs/:id/execute           re-run the tests
POST /api/findings/:id/triage        the human verdict → mints BUG-001
POST /api/content-issues/:id/promote a typo → a real bug, after you say so
POST /api/design-issues/:id/promote  a design mismatch → a real bug, after you say so
GET  /api/integrations               email status (never any secret)
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
| File upload, iframes, popups | — |
| Scheduled runs, CI integration | — |
| Automatic test healing | **Deliberately excluded** — a test that edits itself until it passes silently deletes the assertion that was catching the bug |

### Roadmap, in order

2. **Sitemap and route-manifest discovery** — read `sitemap.xml` and Next.js routes instead of only following links
3. **Visual regression** — save a screenshot baseline, flag pixel changes
4. **Parallel page planning** — one worker per page, once a paid LLM tier makes it safe
5. **Slack notifications** — the same three events, in a channel
6. **Scheduled runs + CI** — nightly, and on every deploy

Shipped since the first cut: **whole-app runs**, **MongoDB**, **runs that start on their own**, **failure detail in the finish email**, **colour / icon / spacing / weight design checks**, **session reuse**, **wording review**, **design-vs-Figma comparison**, **stuck-loader** and **server-data** checks, and the **what-kind** bug category.

---

## 🚢 Releasing

**Push the version, and the release cuts itself.** There is no separate publish step.

Every push to `main` runs CI — backend build, frontend build, secret scan — and then one more job
reads the version out of `package.json`:

```
push to main
     │
     ├─ backend build ─┐
     ├─ frontend build ─┼─ all green? ──► version already tagged? ──► yes ─► stop
     └─ secret scan ───┘                            │
                                                    └─ no ──► tag v0.4.0
                                                              publish the release
                                                              notes = the CHANGELOG section
```

So a release is **a version bump plus a changelog entry** — a two-line diff anyone can raise as a
PR and anyone can review. Merge it and the tag appears. Push a normal commit without touching the
version and nothing is released, which is the point: a tag per commit makes the tag list useless
and "which version is on staging" unanswerable.

### Cutting one

```powershell
.\scripts\release.ps1 -Version 0.4.1 -DryRun     # every check, pushes nothing
.\scripts\release.ps1 -Version 0.4.1 -Message "fix: …"
```

The script runs the same checks **before** anything leaves your machine — secret scan, both
typechecks, both builds, and a check that `CHANGELOG.md` actually has a `## [0.4.1]` section —
then bumps both `package.json` files, commits and pushes. CI does the rest.

Or skip the script entirely: edit the two versions and the changelog by hand, push, done.

### Why the script does not tag

It used to. Now exactly one thing creates tags, and it is the one that has just proven the build
is green on a clean machine. Two taggers is how you end up with a tag on one commit and a release
on another, and the local script cannot know whether CI will pass.

| Guard | What it stops |
|---|---|
| `needs: [backend, frontend, secrets]` | Releasing a broken build, or one with a leaked credential |
| Versions must match in both `package.json` files | A half-done bump, where the tag picks one of two answers |
| `CHANGELOG.md` must have a `## [x.y.z]` section | A release nobody documented. The notes **are** that section — never a list of commit subjects |
| Tag already exists → skip, don't fail | Ordinary pushes after a release are not errors |
| Tag points at `$GITHUB_SHA` | The tag marks the commit that was built, not wherever `main` drifted to since |

> **One-time setup:** Settings → Actions → General → *Workflow permissions* → **Read and write
> permissions**. Without it the release job cannot push a tag. Nothing else is needed — no secret,
> no token: `GITHUB_TOKEN` is issued to the run.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` / port stuck | `.\scripts\kill-ports.ps1` |
| Header says **backend offline** | `cd backend && npm run start:dev` |
| Boot fails listing env problems | Fix exactly those lines in `backend/.env` |
| `401` from the LLM | Wrong `LLM_API_KEY` → `npm run check:llm` |
| `404 model not found` | Wrong `LLM_MODEL` → `npm run check:llm` and copy a listed id |
| `413 Request too large` | Groq free tier is 8000 tokens/min **and counts `LLM_MAX_TOKENS`**. Keep it ≤4000. |
| Scan found 0 elements, screenshot shows **"Loading…"** | Client-rendered app painting late → raise `SCAN_SETTLE_TIMEOUT_MS` |
| Lots of `LOCATOR_NOT_FOUND` | Open **Details → What the AI could see**. If the label is listed, raise `BROWSER_ACTION_TIMEOUT_MS`; if not, edit the test's target |
| `EPERM … query_engine-windows.dll` | The dev server holds the file — `.\scripts\kill-ports.ps1`, then `npx prisma generate` |
| `Server selection timeout` on boot | MongoDB is not running → `docker compose up -d` |
| Writes fail with `not primary` | Your mongod is standalone, not a replica set. Use `docker compose up -d`, or Atlas |
| A whole-app run found only 1 page | It is behind a login and no sign-in URL was given — signed out, the app is a login form with no links |
| A whole-app run is slow | One AI call per page, run sequentially. Lower **Maximum pages** |
| Run says "2 of 6" and COMPLETED | Was a bug (an index rejected the 2nd finding, killing the loop). Fixed — run `npx prisma db push` if you are on an older database |
| No emails arriving | Press **Test** on Account → Integrations. For Gmail you need an App Password, not your password |
| Email links go to localhost | Set `APP_PUBLIC_URL` to the address your team opens |

---

## 🍃 Notes on the MongoDB model

Two things the old SQLite build had to fake are native here, and both are now simply gone:

| Was | Now |
|---|---|
| `packJson()` / `unpackJson()` — JSON stored as text | `Json` columns. Steps, assertions, step timelines, the page snapshot and the AI's evidence are real documents |
| `packTags()` / `unpackTags()` — comma-separated strings | `String[]`. Tags and checks are real arrays |
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
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Build, secret scan, and the release-on-push job |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version — and the source of every release note |

---

<div align="center">

**The honest promise**

> Give it an authorised app and say what should work.
> It finds your pages, writes a test plan for each, runs them in Chrome,
> collects real evidence, and emails you what broke and why.

Not *"enter any URL and AI finds every bug."* That claim doesn't survive contact with a real app.

</div>
