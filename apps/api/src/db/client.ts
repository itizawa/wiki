import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };

/** postgres-js（本番）とPGlite（テスト）の両方を受けるDB型。トランザクションもこの型として扱える。 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
