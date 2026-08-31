-- CreateTable
CREATE TABLE "content_issues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "suggestion" TEXT,
    "reason" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0,
    "whereSeen" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_issues_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "content_issues_runId_status_idx" ON "content_issues"("runId", "status");
