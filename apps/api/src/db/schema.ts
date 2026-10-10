import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// wiki：ページ・ツリー（1本）・予約のまとまり
// ---------------------------------------------------------------------------

export const wikis = pgTable("wikis", {
  id: text("id").primaryKey(),
  /** 公開サイトのサブドメイン。作成後は変えない。アーカイブ中もほかの wiki では使えない */
  key: text("key").notNull().unique(),
  /** 表示名（公開サイトの名前） */
  name: text("name").notNull(),
  /** 管理画面で wiki を見分けるための画像の URL（http(s)）。null なら表示名の頭文字を出す */
  iconUrl: text("icon_url"),
  /** Google Analytics（GA4）の測定 ID（`G-` で始まる）。null なら公開サイトに Google タグを出さない */
  gaMeasurementId: text("ga_measurement_id"),
  /** Google サーチコンソールの確認用の値（meta タグの content の中身）。null なら出さない */
  searchConsoleVerification: text("search_console_verification"),
  /** GA4 のプロパティ ID（数字だけ）。「アクセス解析」が数字を読むのに使う。公開サイトには出さない */
  gaPropertyId: text("ga_property_id"),
  /** nullなら使用中 */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  /** 作った人のメールアドレス。移行で作った最初の wiki は null */
  createdBy: text("created_by"),
});

const wikiId = () =>
  text("wiki_id")
    .notNull()
    .references(() => wikis.id);

// ---------------------------------------------------------------------------
// 4.1 コンテンツ
// ---------------------------------------------------------------------------

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    wikiId: wikiId(),
    /** head版タイトルのキャッシュ */
    title: text("title").notNull(),
    /** アイコン（絵文字1つ）。nullなら付けていない。版には入れない */
    icon: text("icon"),
    headVersionId: uuid("head_version_id").notNull(),
    /** nullなら未公開 */
    publishedVersionId: uuid("published_version_id"),
    visibility: text("visibility", { enum: ["public", "unlisted", "private"] }).notNull().default("private"),
    /** unlisted時のみ。推測不能なランダム値（128bit以上） */
    unlistedKey: text("unlisted_key").unique(),
    origin: text("origin", { enum: ["human", "ai_draft"] }).notNull().default("human"),
    /** 内部管理用（公開側には出さない） */
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    /** 記事の公開日（表示・RSS・並び順） */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    /** 12.3 収益化の受け口。例: { "affiliate": true } */
    monetization: jsonb("monetization"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** ゴミ箱に入れた日時。nullならゴミ箱に入っていない */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * いっしょにゴミ箱に入れたページのまとまり。削除で選んだページ（まとまりの先頭）の ID が入り、先頭のページでは自分の ID。
     * 元に戻す・完全に削除するのは、まとまりごと
     */
    trashRootId: text("trash_root_id"),
    /** ゴミ箱に入れる前の親ページ（nullなら最上位）と、兄弟の中の並び。元に戻すときに使う */
    trashedParentId: text("trashed_parent_id"),
    trashedPosition: text("trashed_position"),
    /**
     * 完全に削除した日時。版・下書きなどは消し、行だけを残す
     * （公開したことがあるページを公開サイトで 410 にし続けるためと、構造の履歴がこの行を指しているため）
     */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [
    check("pages_visibility_check", sql`${t.visibility} in ('public', 'unlisted', 'private')`),
    check("pages_origin_check", sql`${t.origin} in ('human', 'ai_draft')`),
    index("pages_wiki_updated_at_idx").on(t.wikiId, t.updatedAt),
  ],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 派生元（差分・楽観ロック） */
    baseVersionId: uuid("base_version_id"),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    /** AIへ渡す要約 */
    summary: text("summary"),
    authorType: text("author_type", { enum: ["human", "ai"] }).notNull(),
    sourceProposalId: uuid("source_proposal_id"),
    /** 外部のアプリ（MCP）から保存した版なら、その連携 */
    oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
    /** 作った人のメールアドレス。外部のアプリ（MCP）から保存した版と、この列を足す前の版は null */
    authorEmail: text("author_email"),
    /**
     * 間引かずに残す版か。人が操作して作った版と、公開・予約に使った版は true。
     * ワーカーが下書きから自動で作った版は false（あとで間引いてよい）
     */
    keep: boolean("keep").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("page_versions_author_type_check", sql`${t.authorType} in ('human', 'ai')`),
    index("page_versions_page_id_idx").on(t.pageId, t.createdAt),
  ],
);

/**
 * 編集中の下書き（自動保存）。人ごとに1つだけ持つ。編集が一段落したらワーカーが版にし、版になったら消す
 * （人が操作して版を作ったときも消す）。
 * base_version_id は下書きを始めたときの head。head が先に進んでいたら、下書きは古い版をもとにしている。
 */
export const pageDrafts = pgTable(
  "page_drafts",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    authorEmail: text("author_email").notNull(),
    baseVersionId: uuid("base_version_id").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    /** 下書きを始めた時刻。打ち続けているあいだも、ここから一定時間で版にする */
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.authorEmail] })],
);

export const pageLinks = pgTable(
  "page_links",
  {
    fromPageId: text("from_page_id")
      .notNull()
      .references(() => pages.id),
    toPageId: text("to_page_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromPageId, t.toPageId] }), index("page_links_to_idx").on(t.toPageId)],
);

/** 新しいページのひな形。ツリーにも公開サイトにも出さない。変数（`{date}` など）はページを作るときに置き換える */
export const pageTemplates = pgTable(
  "page_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 作った人のメールアドレス */
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("page_templates_wiki_idx").on(t.wikiId, t.updatedAt)],
);

/** スター（よく開くページの目印）。管理者ごとに持ち、別のブラウザや端末でも同じものが出る。どの wiki のものかは、ページで決まる。 */
export const pageStars = pgTable(
  "page_stars",
  {
    adminEmail: text("admin_email").notNull(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 並び順（小さいほうが上）。付けたものは末尾に足す */
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.adminEmail, t.pageId] })],
);

/**
 * 公開サイトの閲覧数（日ごとの合計）。公開（public）の記事だけを数え、1件ずつの記録は持たない。
 * 同じブラウザが同じ記事を同じ日（JST）に何度開いても1回（判定はブラウザ側）。Bot を除いた目安の数字。
 * ページを削除しても行は残す（画面には出さない）。
 */
export const pageViewsDaily = pgTable(
  "page_views_daily",
  {
    wikiId: wikiId(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** JST の日付 */
    day: date("day", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.day] }), index("page_views_daily_wiki_day_idx").on(t.wikiId, t.day)],
);

// ---------------------------------------------------------------------------
// 4.2 ツリーと構造の履歴
// 運用するのは、wiki ごとに primary ツリー1本と main だけ。複数ツリー・ブランチ前提のテーブル形は変えずに残している。
// ---------------------------------------------------------------------------

/** 存在宣言のみ。どのコミットにツリーが含まれるかは commit_trees で決まる。 */
export const trees = pgTable("trees", {
  id: text("id").primaryKey(),
  wikiId: wikiId(),
  /** URLに使用（'by-project' 'by-theme'）。wiki の中で重ならない */
  key: text("key").notNull(),
  /** 以前は画面から変えられた表示名。いまはどこにも出していない（公開サイト・管理画面は固定の文言を使う） */
  name: text("name").notNull(),
  /** パンくず・既定ナビ用（1つだけ） */
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [
  unique("trees_wiki_key_unique").on(t.wikiId, t.key),
  // primary は wiki ごとに1つだけ
  uniqueIndex("trees_one_primary_idx").on(t.wikiId).where(sql`${t.isPrimary}`),
]);

/** 1ツリーの状態（イミュータブル） */
export const treeSnapshots = pgTable("tree_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  treeId: text("tree_id")
    .notNull()
    .references(() => trees.id),
  createdAt: createdAt(),
});

export const treeNodes = pgTable(
  "tree_nodes",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => treeSnapshots.id),
    /** ノードはすべてページ。node_id = page_id */
    nodeId: text("node_id").notNull(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** nullなら最上位 */
    parentNodeId: text("parent_node_id"),
    /** fractional index */
    position: text("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.nodeId] }),
    unique("tree_nodes_snapshot_page_unique").on(t.snapshotId, t.pageId),
    check("tree_nodes_page_check", sql`${t.nodeId} = ${t.pageId}`),
    index("tree_nodes_page_id_idx").on(t.pageId),
  ],
);

/** コミット：全ツリーの状態をまとめて記録 */
export const structureCommits = pgTable("structure_commits", {
  id: uuid("id").primaryKey().defaultRandom(),
  wikiId: wikiId(),
  message: text("message"),
  authorType: text("author_type", { enum: ["human", "ai"] }).notNull().default("human"),
  sourceProposalId: uuid("source_proposal_id"),
  /** 外部のアプリ（MCP）からの操作なら、その連携 */
  oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
  createdAt: createdAt(),
});

/** 親2つ = マージコミット */
export const structureCommitParents = pgTable(
  "structure_commit_parents",
  {
    commitId: uuid("commit_id")
      .notNull()
      .references(() => structureCommits.id),
    parentCommitId: uuid("parent_commit_id").notNull(),
    /** 0 = 第1親（ブランチの直前のhead）。マージ時は1がマージ元。 */
    ordinal: integer("ordinal").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.commitId, t.parentCommitId] }),
    // 自動生成名はPostgresの識別子上限（63文字）を超えるので明示する
    foreignKey({ name: "structure_commit_parents_parent_fk", columns: [t.parentCommitId], foreignColumns: [structureCommits.id] }),
  ],
);

export const commitTrees = pgTable(
  "commit_trees",
  {
    commitId: uuid("commit_id")
      .notNull()
      .references(() => structureCommits.id),
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id),
    /** 変更のないツリーは親と同じsnapshotを指す */
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => treeSnapshots.id),
  },
  (t) => [primaryKey({ columns: [t.commitId, t.treeId] })],
);

/** ブランチ（名前付きポインタ）。wiki ごとに main のみ運用。 */
export const structureBranches = pgTable(
  "structure_branches",
  {
    wikiId: wikiId(),
    name: text("name").notNull(),
    headCommitId: uuid("head_commit_id")
      .notNull()
      .references(() => structureCommits.id),
    kind: text("kind", { enum: ["main", "manual", "ai_proposal"] }).notNull(),
    createdAt: createdAt(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.wikiId, t.name] }),
    check("structure_branches_kind_check", sql`${t.kind} in ('main', 'manual', 'ai_proposal')`),
  ],
);

// ---------------------------------------------------------------------------
// 4.6 予約公開 ／ 7 公開パイプライン
// ---------------------------------------------------------------------------

export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    actionType: text("action_type", { enum: ["publish_page", "unpublish_page", "merge_branch"] }).notNull(),
    /** publish / unpublish */
    pageId: text("page_id").references(() => pages.id),
    /** publish時に固定する版（予約後の編集は含めない） */
    versionId: uuid("version_id").references(() => pageVersions.id),
    /** publish時の公開範囲（通常 'public'） */
    targetVisibility: text("target_visibility", { enum: ["public", "unlisted"] }),
    /** merge_branch（フェーズ3） */
    branchName: text("branch_name"),
    /** 同時公開グループ（シリーズ記事など）。同じ batch_id は1トランザクションで実行する */
    batchId: uuid("batch_id"),
    /** 外部のアプリ（MCP）が入れた予約なら、その許可 */
    oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
    /** UTC保存。入出力はJST */
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["scheduled", "running", "done", "failed", "canceled"] })
      .notNull()
      .default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "scheduled_actions_action_type_check",
      sql`${t.actionType} in ('publish_page', 'unpublish_page', 'merge_branch')`,
    ),
    check(
      "scheduled_actions_status_check",
      sql`${t.status} in ('scheduled', 'running', 'done', 'failed', 'canceled')`,
    ),
    index("scheduled_actions_due_idx").on(t.runAt).where(sql`${t.status} = 'scheduled'`),
    index("scheduled_actions_page_idx").on(t.pageId),
  ],
);

/** 公開状態に影響する操作の記録。ワーカーがデバウンスしてビルドを起動する。 */
export const publishEvents = pgTable("publish_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  wikiId: wikiId(),
  kind: text("kind").notNull(),
  pageId: text("page_id"),
  scheduledActionId: uuid("scheduled_action_id"),
  /** 外部のアプリ（MCP）からの操作なら、その許可 */
  oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
  createdAt: createdAt(),
});

/** 起動したビルド。last_event_id までの publish_events を反映済み。 */
export const siteBuilds = pgTable("site_builds", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 外部のアプリ（MCP クライアント）からの操作：OAuth 2.1
// トークン・認可コードは平文を持たず、SHA-256 のハッシュだけを持つ
// ---------------------------------------------------------------------------

/** 動的クライアント登録（RFC 7591）で登録したアプリ。公開クライアント（秘密鍵なし、PKCE 必須）だけを扱う */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 完全一致で比べる */
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** 人がアプリに与えた許可（同意）。取り消すと、そこから出たトークンは次のリクエストから通らない */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id),
    /** 許可した人。ADMIN_EMAILS から外れると、この許可も使えなくなる */
    userEmail: text("user_email").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    createdAt: createdAt(),
    /** これを過ぎたら、もう一度同意し直す */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** レート制限（固定窓）の窓の始まりと、その中の回数 */
    rateWindowStart: timestamp("rate_window_start", { withTimezone: true }),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
  },
  (t) => [index("oauth_grants_user_idx").on(t.userEmail, t.createdAt)],
);

/** 認可コード。1回だけ使える */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  grantId: uuid("grant_id")
    .notNull()
    .references(() => oauthGrants.id),
  redirectUri: text("redirect_uri").notNull(),
  /** PKCE（S256） */
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** アクセストークン（短命）とリフレッシュトークン（使うたびに入れ替える） */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** リフレッシュトークンは、使った（入れ替えた）ときにも入る */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("oauth_tokens_kind_check", sql`${t.kind} in ('access', 'refresh')`),
    index("oauth_tokens_grant_idx").on(t.grantId),
  ],
);

// ---------------------------------------------------------------------------
// アクセス解析（Google Analytics・サーチコンソールの数字の控え）
// ---------------------------------------------------------------------------

/**
 * Google へ問い合わせた結果の控え。wiki・種類・期間ごとに1行で、同じ期間は1時間のあいだ使い回す。
 * 問い合わせが失敗したときは `data` と `fetched_at` を残し、`error` と `attempted_at` だけを書き換える（前に取れたぶんを「◯時点の数字」として出す）。
 */
export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    wikiId: wikiId(),
    kind: text("kind", { enum: ["ga", "search_console"] }).notNull(),
    /** 期間（日数） */
    days: integer("days").notNull(),
    /** 問い合わせた先（GA はプロパティ ID、サーチコンソールはサイトの URL）。設定が変わったら、この行は使わない */
    target: text("target").notNull(),
    /** 取れた数字。1回も取れていなければ null */
    data: jsonb("data"),
    /** data を取った日時 */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** 最後に Google へ問い合わせた日時（失敗したときも入る）。取り直しの間隔に使う */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    /** 最後の問い合わせが失敗した理由（GoogleFailure）。成功したら null */
    error: text("error"),
  },
  (t) => [primaryKey({ columns: [t.wikiId, t.kind, t.days] }), check("analytics_snapshots_kind_check", sql`${t.kind} in ('ga', 'search_console')`)],
);
