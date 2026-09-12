import type { Prisma } from '@prisma/client';

/**
 * THE JSON COLUMN BOUNDARY.
 *
 * MongoDB stores `steps`, `assertions`, `stepResults`, `aiEvidence`,
 * `pageSnapshot` and `payload` as real documents, so there is no serialisation
 * to do any more — this file replaced src/common/db-json.ts, which existed only
 * because SQLite had no Json type.
 *
 * What remains is a TYPE boundary, not a format one. Prisma hands a Json column
 * back as `Prisma.JsonValue`, which is honest: the driver cannot know that a
 * particular document is a TestStep[]. These two helpers are the one place that
 * assertion is made, so it is auditable, and they never throw — a row written by
 * an older version of the schema returns the fallback instead of taking down an
 * API response.
 */

/** Anything Prisma will accept for a Json column. */
export type JsonIn = Prisma.InputJsonValue;

/**
 * Json column -> typed value.
 *
 * Returns the fallback for null, undefined and Prisma's DbNull/JsonNull
 * sentinels, so callers never have to test for them.
 */
export function readJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  // Legacy rows from the SQLite era hold JSON *text* in these fields. Parsing
  // it here means an existing database keeps working after the migration
  // instead of rendering empty step timelines.
  if (typeof value === 'string') {
    if (value === '') return fallback;
    try {
      const parsed = JSON.parse(value) as T;
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Typed value -> Json column.
 *
 * Only exists to keep `undefined` out of a write: Prisma treats an explicit
 * `undefined` as "do not touch this field", which silently skips the update.
 */
export function writeJson(value: unknown): JsonIn {
  return (value ?? null) as JsonIn;
}

/**
 * Optional variant. Returns `undefined` for an absent value so Prisma OMITS the
 * field rather than storing a null.
 *
 * That distinction matters on MongoDB: a unique index counts explicit nulls as
 * equal values, so writing `null` into an optional unique field twice is a
 * duplicate-key error, while omitting it is not.
 */
export function writeJsonNullable(value: unknown): JsonIn | undefined {
  return value === undefined || value === null ? undefined : value;
}
