-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "statusMessage" TEXT,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "allowDestructive" BOOLEAN NOT NULL DEFAULT false,
    "pageSnapshot" TEXT,
    "llmModel" TEXT,
    "llmTokensIn" INTEGER,
    "llmTokensOut" INTEGER,
    "llmLatencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanStartedAt" DATETIME,
    "planStartedAt" DATETIME,
    "execStartedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "emailCipher" TEXT,
    "passwordCipher" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_secrets_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "source" TEXT NOT NULL DEFAULT 'LLM',
    "order" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT NOT NULL DEFAULT '',
    "rationale" TEXT,
    "requirement" TEXT,
    "steps" TEXT NOT NULL,
    "assertions" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" DATETIME,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "destructive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_cases_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "failedStepIndex" INTEGER,
    "failedStepLabel" TEXT,
    "expected" TEXT,
    "actual" TEXT,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "browserName" TEXT NOT NULL DEFAULT 'chromium',
    "browserVersion" TEXT,
    "viewport" TEXT,
    "finalUrl" TEXT,
    "stepResults" TEXT NOT NULL,
    "screenshotPath" TEXT,
    "tracePath" TEXT,
    CONSTRAINT "test_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "test_results_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "console_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "location" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "console_logs_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "network_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "statusText" TEXT,
    "resourceType" TEXT,
    "failureText" TEXT,
    "durationMs" INTEGER,
    "isApiError" BOOLEAN NOT NULL DEFAULT false,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "network_logs_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "severity" TEXT,
    "assignee" TEXT,
    "signature" TEXT NOT NULL,
    "aiClassification" TEXT,
    "aiConfidence" REAL,
    "aiSummary" TEXT,
    "aiSuspectedCause" TEXT,
    "aiEvidence" TEXT,
    "humanClassification" TEXT,
    "triagedBy" TEXT,
    "triagedAt" DATETIME,
    "note" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "findings_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "finding_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "findingId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'qa@local',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finding_events_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "policy_rejections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "policy_rejections_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "runs_projectId_createdAt_idx" ON "runs"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "run_secrets_runId_key" ON "run_secrets"("runId");

-- CreateIndex
CREATE INDEX "test_cases_runId_order_idx" ON "test_cases"("runId", "order");

-- CreateIndex
CREATE INDEX "test_results_runId_idx" ON "test_results"("runId");

-- CreateIndex
CREATE INDEX "test_results_testCaseId_attempt_idx" ON "test_results"("testCaseId", "attempt");

-- CreateIndex
CREATE INDEX "console_logs_resultId_level_idx" ON "console_logs"("resultId", "level");

-- CreateIndex
CREATE INDEX "network_logs_resultId_isApiError_idx" ON "network_logs"("resultId", "isApiError");

-- CreateIndex
CREATE UNIQUE INDEX "findings_resultId_key" ON "findings"("resultId");

-- CreateIndex
CREATE INDEX "findings_runId_status_idx" ON "findings"("runId", "status");

-- CreateIndex
CREATE INDEX "findings_signature_idx" ON "findings"("signature");

-- CreateIndex
CREATE INDEX "finding_events_findingId_createdAt_idx" ON "finding_events"("findingId", "createdAt");

-- CreateIndex
CREATE INDEX "policy_rejections_runId_idx" ON "policy_rejections"("runId");
