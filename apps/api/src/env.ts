import type { AppConfig } from "./config";
import type { CronMarkStore } from "./cron/marks";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";
import type { XClient } from "./sns/x-client";
import type { GoogleReporting } from "./analytics/google";
import type { ImageStore } from "./images/store";
import type { RateLimiters } from "./rate-limit";
import type { CostSource } from "./costs/neon";
import type { LinkFetch } from "./linkPreview/fetch";
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
  /** SNS 連携の X の API。無ければ（`config.x` が null）X 連携は使えない */
  x?: XClient | null;
  /** Routine を呼ぶ `fetch`。無ければ `fetch`。テストで差し替える */
  routineFetch?: typeof fetch | null;
  /**
   * Cron のワーカーへの印を書く先（Workers KV）。無ければ印を書かない
   * （手元の開発とテスト。ワーカーの側も、バインディングが無ければ毎回 DB を見に行く）
   */
  cronMarks?: CronMarkStore | null;
  /** ログインせずに叩ける経路（/oauth/*・/mcp）の、接続元ごとの回数の制限。無ければ制限しない */
  rateLimits?: RateLimiters | null;
  /** 外部の URL の OGP を取りにいく関数（`GET /link-preview`）。無ければ `fetch`。テストで差し替える */
  linkFetch?: LinkFetch | null;
  /** 運用コストの使用量を取るもの。無ければ設定（`config.neon`）から作る。テストで差し替える */
  costSources?: CostSource[] | null;
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
