# AI Automation Product

AI-powered test automation platform that converts application requirements into structured test cases and validates them using real browser automation.

## 🚀 Overview

Give the platform an authorized URL and requirements in plain English.

The platform:

1. Scans the application using Playwright
2. Uses an LLM to generate structured test cases
3. Validates test cases through a safety/policy layer
4. Allows QA engineers to review and approve tests
5. Executes approved tests in a real browser
6. Captures screenshots, traces, logs, and network errors
7. Generates findings and bug reports from failures

> **Human approval is required before any generated test is executed.**

## 🏗️ Architecture

```text
Requirements
     ↓
Page Scanner
     ↓
AI Test Case Generation
     ↓
Policy & Schema Validation
     ↓
Human Review & Approval
     ↓
Playwright Browser Execution
     ↓
Results & Evidence
     ↓
Findings / Bug Reports
```

## 🛠️ Tech Stack

| Layer              | Technology                           |
| ------------------ | ------------------------------------ |
| Frontend           | Next.js 15, TypeScript, Tailwind CSS |
| Backend            | NestJS 11, TypeScript                |
| Database           | SQLite + Prisma                      |
| Browser Automation | Playwright                           |
| LLM                | Groq / OpenAI-compatible API         |
| Authentication     | JWT + scrypt                         |
| Infrastructure     | Docker                               |

## ✨ Key Features

* AI-generated test cases from plain-English requirements
* Real browser execution with Playwright
* Human approval before test execution
* Deterministic PASS / FAIL assertions
* Screenshots and Playwright traces
* Console and API error detection
* Failure reproducibility checks
* AI-assisted failure classification
* QA finding and triage workflow
* Bug report generation
* Ticket management
* Role-based authentication
* Audit trail for QA decisions

## 📁 Project Structure

```text
AI-Automation-Product/
├── backend/          # NestJS API + Playwright automation
├── frontend/         # Next.js dashboard
├── docs/             # Architecture, API and database documentation
├── artifacts/        # Screenshots and traces (gitignored)
├── docker-compose.yml
└── README.md
```

## 🚀 Getting Started

### Prerequisites

* Node.js 18+
* npm
* Playwright
* Docker (optional)
* LLM API key

### Backend

```bash
cd backend
npm install

cp .env.example .env

npx prisma migrate dev --name init
npx playwright install chromium

npm run start:dev
```

Backend:

```text
http://localhost:4000/api
```

### Frontend

```bash
cd frontend
npm install

cp .env.local.example .env.local

npm run dev
```

Frontend:

```text
http://localhost:3000
```

## 🔑 Environment Variables

Configure the required values in:

```text
backend/.env
```

Example:

```env
LLM_API_KEY=your_api_key
LLM_MODEL=your_model
JWT_SECRET=your_secret
DATABASE_URL=file:./dev.db
```

Never commit `.env` or API keys to the repository.

## 🧪 Test Workflow

A typical workflow is:

```text
1. Enter application URL
2. Enter requirements
3. Confirm authorization
4. Scan application
5. Generate test cases
6. Review / edit / approve tests
7. Execute approved tests
8. Review results
9. Investigate failures
10. Confirm or reject findings
11. Generate bug report
```

## 🔐 Safety

The platform uses multiple safety layers:

* The LLM does not directly control the browser
* Generated actions are schema validated
* Only approved actions/assertions are allowed
* Tests are restricted to the authorized origin
* Destructive actions are controlled by policy
* Human approval is required before execution
* Test credentials are encrypted and never sent to the LLM

## 📊 Failure Handling

A failed test is treated as a **finding**, not automatically as a product bug.

```text
Test Failure
     ↓
Clean Rerun
     ↓
Flaky? ── Yes → FLAKY
     │
     No
     ↓
Finding Created
     ↓
Human Triage
     ↓
┌───────────────┐
│ Confirm       │ → Product Bug
│ Reject        │ → Test / Environment / Data Issue
└───────────────┘
```

## 📚 Documentation

Detailed documentation is available in the `docs/` directory:

* `docs/ARCHITECTURE.md` — system architecture
* `docs/API.md` — API reference
* `docs/schema.postgres.prisma` — PostgreSQL schema

## 🚧 MVP Limitations

The current MVP intentionally does not include:

* Multi-tenancy
* Redis/job queues
* Electron desktop client
* Firefox/WebKit/mobile emulation
* Live Jira API integration
* Scheduled reports
* Visual regression testing
* Full application crawling
* Automatic test healing
* CI integration

These can be added in future iterations.

## 📌 Project Status

**Status:** MVP / Active Development

The current focus is validating the core AI → test generation → human approval → browser execution → evidence → QA workflow.

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome.

Please open an issue or submit a pull request.

## 📄 License

This project is currently intended for development and evaluation purposes.
