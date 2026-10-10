import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };

/** postgres-js（本番）とPGlite（テスト）の両方を受けるDB型。トランザクションもこの型として扱える。 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** `db.execute` の結果の行。postgres-js は配列、PGlite は { rows } を返すので吸収する。 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
