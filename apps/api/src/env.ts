import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { wikis } from "./db/schema";
import type { WikiRole } from "@wiki/shared";
import type { UserRow } from "./users/service";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    /** ログインしている人（/admin/* で、リクエストのたびに DB から引く） */
    user: UserRow;
    /** `/admin/w/:wikiKey/*` で開いている wiki */
    wiki: typeof wikis.$inferSelect;
    /** 開いている wiki での、ログインしている人のロール（オーナーは管理者） */
    role: WikiRole;
  };
};
