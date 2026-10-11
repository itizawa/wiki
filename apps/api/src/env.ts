import type { AppConfig } from "./config";
import type { CronMarkStore } from "./cron/marks";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { GoogleReporting } from "./analytics/google";
import type { ImageStore } from "./images/store";
import type { wikis } from "./db/schema";
import type { WikiRole } from "@wiki/shared";
import type { UserRow } from "./users/service";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
  /** アップロードした画像の置き場所。無ければアップロードできない（503） */
  images?: ImageStore | null;
  /** Google Analytics とサーチコンソールの数字を読むもの。無ければ「アクセス解析」は未設定として出す */
  reporting?: GoogleReporting | null;
  /**
   * Cron のワーカーへの印を書く先（Workers KV）。無ければ印を書かない
   * （手元の開発とテスト。ワーカーの側も、バインディングが無ければ毎回 DB を見に行く）
   */
  cronMarks?: CronMarkStore | null;
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
