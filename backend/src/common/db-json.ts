/**
 * THE SQLITE SERIALISATION BOUNDARY.
 *
 * SQLite (through Prisma) has no `Json` column type and no scalar lists, so
 * structured data is stored as text. Every conversion happens here and nowhere
 * else — which means that when the project moves to PostgreSQL, this file is the
 * only thing that gets deleted.
 *
 * Rule: pack* on the way IN to the database, unpack* on the way OUT.
 */

/** Object/array -> JSON text for a SQLite column. */
export function packJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Optional variant: null stays null instead of becoming the string "null". */
export function packJsonNullable(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * JSON text -> object/array.
 *
 * Never throws. Corrupt or truncated text returns the fallback, because losing
 * one field must not take down a whole API response.
 */
export function unpackJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    const parsed = JSON.parse(text) as T;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** string[] -> comma-separated text. Commas inside a tag are stripped. */
export function packTags(tags: string[] | undefined | null): string {
  if (!tags?.length) return '';
  return tags
    .map((t) => t.replace(/,/g, ' ').trim())
    .filter(Boolean)
    .join(',');
}

/** comma-separated text -> string[]. */
export function unpackTags(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
