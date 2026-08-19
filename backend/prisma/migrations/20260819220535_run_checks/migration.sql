-- Adds the tickable-check selection to a run.
-- Comma-separated ids from src/common/check-catalog.ts.
ALTER TABLE "runs" ADD COLUMN "checks" TEXT NOT NULL DEFAULT '';
