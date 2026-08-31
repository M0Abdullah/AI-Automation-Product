-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'TEST',
    "resultId" TEXT,
    "testCaseId" TEXT,
    "runId" TEXT NOT NULL,
    "contentIssueId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "severity" TEXT,
    "assignee" TEXT,
    "signature" TEXT NOT NULL,
    "aiClassification" TEXT,
    "aiCategory" TEXT,
    "aiConfidence" REAL,
    "aiSummary" TEXT,
    "aiSuspectedCause" TEXT,
    "aiEvidence" TEXT,
    "humanClassification" TEXT,
    "triagedBy" TEXT,
    "triagedAt" DATETIME,
    "note" TEXT,
    "bugKey" TEXT,
    "bugNumber" INTEGER,
    "module" TEXT,
    "build" TEXT,
    "priority" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "findings_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_contentIssueId_fkey" FOREIGN KEY ("contentIssueId") REFERENCES "content_issues" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_findings" ("aiCategory", "aiClassification", "aiConfidence", "aiEvidence", "aiSummary", "aiSuspectedCause", "assignee", "bugKey", "bugNumber", "build", "createdAt", "humanClassification", "id", "lastSeenAt", "module", "note", "occurrences", "priority", "resultId", "runId", "severity", "signature", "status", "testCaseId", "triagedAt", "triagedBy", "updatedAt") SELECT "aiCategory", "aiClassification", "aiConfidence", "aiEvidence", "aiSummary", "aiSuspectedCause", "assignee", "bugKey", "bugNumber", "build", "createdAt", "humanClassification", "id", "lastSeenAt", "module", "note", "occurrences", "priority", "resultId", "runId", "severity", "signature", "status", "testCaseId", "triagedAt", "triagedBy", "updatedAt" FROM "findings";
DROP TABLE "findings";
ALTER TABLE "new_findings" RENAME TO "findings";
CREATE UNIQUE INDEX "findings_resultId_key" ON "findings"("resultId");
CREATE UNIQUE INDEX "findings_contentIssueId_key" ON "findings"("contentIssueId");
CREATE UNIQUE INDEX "findings_bugKey_key" ON "findings"("bugKey");
CREATE UNIQUE INDEX "findings_bugNumber_key" ON "findings"("bugNumber");
CREATE INDEX "findings_runId_status_idx" ON "findings"("runId", "status");
CREATE INDEX "findings_signature_idx" ON "findings"("signature");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
