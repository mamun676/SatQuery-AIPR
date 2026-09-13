/**
 * Identifier guards for the API routes.
 *
 * All job/upload identifiers are Postgres `uuid` columns. Passing a
 * non-UUID string straight into a query makes the driver raise
 * `invalid input syntax for type uuid`, which surfaced as an opaque HTTP 500
 * with an empty body. Validating the shape first turns that into an
 * actionable 400.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
