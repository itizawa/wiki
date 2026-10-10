import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { ImageStore } from "./images/store";
import type { wikis } from "./db/schema";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
  /** アップロードした画像の置き場所。無ければアップロードできない（503） */
  images?: ImageStore | null;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    adminEmail: string;
    /** `/admin/w/:wikiKey/*` で開いている wiki */
    wiki: typeof wikis.$inferSelect;
  };
};
