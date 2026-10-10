import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { wikis } from "./db/schema";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    adminEmail: string;
    /** `/admin/w/:wikiKey/*` で開いている wiki */
    wiki: typeof wikis.$inferSelect;
  };
};
