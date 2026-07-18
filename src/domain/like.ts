/** Escapes Postgres ILIKE wildcards so a literal `%`/`_`/`\` in the query is
 * matched literally rather than as a pattern metacharacter. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (m) => `\\${m}`);
}
