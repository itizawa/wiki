import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { WikiRole } from "@wiki/shared";
import type { users, wikis } from "./db/schema";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    /** ログインしている人（リクエストのたびに DB から引く） */
    user: typeof users.$inferSelect;
    /** `/admin/w/:wikiKey/*` で開いている wiki */
    wiki: typeof wikis.$inferSelect;
    /** 開いている wiki でのロール（オーナーは管理者） */
    role: WikiRole;
  };
};
