import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
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
  /**
   * 公開サイトの見た目（テーマの key・ロゴ・ファビコン。`WikiTheme`）。null なら既定。
   * 読むときは resolveTheme を通し、欠けた・正しくない項目は既定に戻す
   */
  theme: jsonb("theme"),
  /**
   * 公開サイトのトップの設定（自由記述。`WikiHome`）。null なら既定（何も出さない）。
   * 読むときは resolveHome を通す。あとでトップの部品の並びなどを足せるよう、オブジェクトで持つ
   */
  home: jsonb("home"),
  /** Google Analytics（GA4）の測定 ID（`G-` で始まる）。null なら公開サイトに Google タグを出さない */
  gaMeasurementId: text("ga_measurement_id"),
  /** Google サーチコンソールの確認用の値（meta タグの content の中身）。null なら出さない */
  searchConsoleVerification: text("search_console_verification"),
  /** GA4 のプロパティ ID（数字だけ）。「アクセス解析」が数字を読むのに使う。公開サイトには出さない */
  gaPropertyId: text("ga_property_id"),
  /** 公開サイトを出しているか。false なら、ページごとの公開範囲は変えずに、サイトだけをビルドから外す（アーカイブとは別） */
  sitePublic: boolean("site_public").notNull().default(true),
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
     * （公開したことがあるページを公開サイトで 410 にし続けるため）
     */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [
    check("pages_visibility_check", sql`${t.visibility} in ('public', 'unlisted', 'private')`),
    check("pages_origin_check", sql`${t.origin} in ('human', 'ai_draft')`),
    // 一覧の並び（更新日時の新しい順、同じ日時は id の大きい順）と、その続き `(updated_at, id) < (...)` に使う
    // `desc` だけだと drizzle は NULLS LAST を付け、`order by ... desc`（NULLS FIRST）の並びと合わなくなる
    index("pages_wiki_updated_at_id_idx").on(t.wikiId, t.updatedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    // 版の間引きが「どれかのページの head・公開中の版か」を版ごとに引く
    index("pages_head_version_idx").on(t.headVersionId),
    index("pages_published_version_idx").on(t.publishedVersionId),
    // ゴミ箱のまとまり（一覧の配下の数、元に戻す・完全に削除するときの行）
    index("pages_trash_root_idx").on(t.trashRootId).where(sql`${t.deletedAt} is not null and ${t.purgedAt} is null`),
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
    /** 作った人（自動でできた版は、もとの下書きを書いていた人。外部のアプリ（MCP）から保存した版は、許可した人）。この列を足す前の版は null */
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
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
    // 版の間引きが、消した版を派生元にしている版を引く
    index("page_versions_base_version_idx").on(t.baseVersionId),
  ],
);

/**
 * 検索用の、head 版のタイトルと本文の写し。管理画面の検索（`routes/search.ts`）が、ここを `ILIKE '%語%'` で探す。
 *
 * - 版（`page_versions`）は過去の本文も持つので、そこに索引を付けると、探さない本文まで索引に入る。
 *   `pages` に本文を持たせると、公開・ゴミ箱などで `pages` の行を書き換えるたびに本文の索引も作り直され、
 *   `pages` を読むすべての所が本文まで読むことになる。なので表を分けている
 * - タイトルもここに持つのは、「タイトルか本文に含む」（OR）を1つの表の2つの索引で引けるようにするため
 * - **head 版を進める所は、同じトランザクションで `syncPageSearch`（`pages/versions.ts`）を呼ぶ**。
 *   `createPage` と `createVersion` が呼んでいるので、この2つを通せば足りる
 * - 完全に削除したページの行は消す（本文を残さない）。ゴミ箱のページの行は残す（元に戻せば、また探せる）
 * - 索引は pg_trgm の GIN。3文字以上の語で効く（1〜2文字の語は、この表を全部読む）
 */
export const pageSearch = pgTable(
  "page_search",
  {
    pageId: text("page_id")
      .primaryKey()
      .references(() => pages.id),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
  },
  (t) => [
    index("page_search_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("page_search_body_trgm_idx").using("gin", t.bodyMd.op("gin_trgm_ops")),
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
    /** 書いている人。下書きは人ごとに持つ */
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    baseVersionId: uuid("base_version_id").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    /** 下書きを始めた時刻。打ち続けているあいだも、ここから一定時間で版にする */
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] })],
);

/**
 * 編集リクエスト：1ページに対する1回分。箇所ごとの項目（`edit_request_items`）を束ねる。
 * リクエスト自体に状態は持たせない（未対応の項目が0件になったら完了）。
 */
export const editRequests = pgTable(
  "edit_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 全体へのひとこと */
    comment: text("comment"),
    /** 出した人。外部のアプリ（MCP）から出したものは、許可した人 */
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    /** 外部のアプリ（MCP）から出したものなら、その連携 */
    oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
    createdAt: createdAt(),
  },
  (t) => [
    // ページごとの一覧（新しい順）
    index("edit_requests_page_idx").on(t.pageId, t.createdAt),
    // wiki ごとの一覧（新しい順）
    index("edit_requests_wiki_idx").on(t.wikiId, t.createdAt),
  ],
);

/**
 * 編集リクエストの項目。位置は「基準の版・本文（Markdown）の行の範囲・その範囲の元の文面」で持つ（行の数え方は `bodyLines`）。
 * 出したあとは書き換えない（直すときは、取り下げて出し直す）。変わるのは状態と、決めた人・日時・採用でできた版だけ。
 * 「古くなった」は状態に持たない（未対応のまま。読むたびに最新の版から決める）。
 */
export const editRequestItems = pgTable(
  "edit_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => editRequests.id),
    /** リクエストの中での並び（0 から） */
    position: integer("position").notNull(),
    /** 項目の種類。suggestion: 提案（置き換え案を持つ）、note: 指摘（置き換え案を持たず、本文を持つ） */
    kind: text("kind", { enum: ["suggestion", "note"] }).notNull().default("suggestion"),
    /** 基準の版。項目が残っているあいだは、版の間引き（`pages/prune.ts`）で消さない */
    baseVersionId: uuid("base_version_id")
      .notNull()
      .references(() => pageVersions.id),
    /** 基準の版での行の範囲（1から数え、両端を含む） */
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    /** 基準の版で、その範囲にあった文面（Markdown）。サーバーが切り出す */
    originalMd: text("original_md").notNull(),
    /** 提案の置き換え案（Markdown）。空の文字なら、その行を消す提案（null とは別）。指摘では null */
    replacementMd: text("replacement_md"),
    /** 提案の理由（任意）。指摘では null */
    reason: text("reason"),
    /** 指摘の本文（プレーンテキスト。必須）。提案では null */
    noteBody: text("note_body"),
    /** 未対応は、種類を問わず open。提案は accepted / rejected、指摘は resolved になる。どちらも withdrawn にできる */
    status: text("status", { enum: ["open", "accepted", "rejected", "resolved", "withdrawn"] }).notNull().default("open"),
    /** 採用・却下・解決済み・取り下げを決めた人と日時。未対応に戻したら null に戻す */
    decidedBy: uuid("decided_by").references((): AnyPgColumn => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** 採用でできた版。「すべて採用」では、複数の項目が同じ版を指す */
    acceptedVersionId: uuid("accepted_version_id").references(() => pageVersions.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("edit_request_items_kind_check", sql`${t.kind} in ('suggestion', 'note')`),
    check("edit_request_items_status_check", sql`${t.status} in ('open', 'accepted', 'rejected', 'resolved', 'withdrawn')`),
    // 種類ごとの形：提案は置き換え案が必須（空の文字は「行を消す」）で本文を持たず、解決済みにならない。
    // 指摘は本文が必須で、置き換え案・理由・採用でできた版を持たず、採用・却下にならない
    check(
      "edit_request_items_kind_shape_check",
      sql`(${t.kind} = 'suggestion' and ${t.replacementMd} is not null and ${t.noteBody} is null and ${t.status} <> 'resolved') or (${t.kind} = 'note' and ${t.replacementMd} is null and ${t.reason} is null and ${t.acceptedVersionId} is null and ${t.noteBody} is not null and btrim(${t.noteBody}) <> '' and ${t.status} not in ('accepted', 'rejected'))`,
    ),
    check("edit_request_items_lines_check", sql`${t.startLine} >= 1 and ${t.endLine} >= ${t.startLine}`),
    unique("edit_request_items_request_position_unique").on(t.requestId, t.position),
    // 版の間引きが「項目が基準にしている版か」を版ごとに引く
    index("edit_request_items_base_version_idx").on(t.baseVersionId),
    // 版履歴が「採用でできた版か」を版ごとに引く
    index("edit_request_items_accepted_version_idx").on(t.acceptedVersionId),
    // 未対応の件数（ページごと・wiki ごと）。提案も指摘も、未対応は open
    index("edit_request_items_open_idx").on(t.requestId).where(sql`${t.status} = 'open'`),
  ],
);

/**
 * 編集リクエストの項目への返信。本文はプレーンテキスト（HTML としても Markdown としても描かない）。
 * 書いたあとは、書き換えも削除もしない（消えるのは、ページを完全に削除したときだけ）。
 */
export const editRequestComments = pgTable(
  "edit_request_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => editRequestItems.id),
    body: text("body").notNull(),
    /** 書いた人。外部のアプリ（MCP）から書いたものは、許可した人 */
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    /** 外部のアプリ（MCP）から書いたものなら、その連携 */
    oauthGrantId: uuid("oauth_grant_id").references(() => oauthGrants.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("edit_request_comments_body_check", sql`btrim(${t.body}) <> ''`),
    // 項目ごとの返信（古い順）
    index("edit_request_comments_item_idx").on(t.itemId, t.createdAt),
  ],
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

/** スター（よく開くページの目印）。ユーザーごとに持ち、別のブラウザや端末でも同じものが出る。どの wiki のものかは、ページで決まる。 */
export const pageStars = pgTable(
  "page_stars",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 並び順（小さいほうが上）。付けたものは末尾に足す */
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

// ---------------------------------------------------------------------------
// 4.2 ツリー
// 運用するのは、wiki ごとに primary ツリー1本だけ。複数ツリー前提のテーブル形は変えずに残している。
// ---------------------------------------------------------------------------

/** ツリーの存在宣言。ノードは tree_nodes に、現在の状態だけを持つ（過去の状態は残さない）。 */
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

export const treeNodes = pgTable(
  "tree_nodes",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id),
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
    primaryKey({ columns: [t.treeId, t.nodeId] }),
    unique("tree_nodes_tree_page_unique").on(t.treeId, t.pageId),
    check("tree_nodes_page_check", sql`${t.nodeId} = ${t.pageId}`),
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
    /** 予約を入れた人。これより前の予約は null */
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
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
    // 版の間引きが「予約が指している版か」を版ごとに引く
    index("scheduled_actions_version_idx").on(t.versionId),
    // 編集カレンダー（wiki ごとの、期間の中の予約。状態は問わない）
    index("scheduled_actions_wiki_run_at_idx").on(t.wikiId, t.runAt),
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

/** 起動を決めたビルド。last_event_id までの publish_events を反映済み。 */
export const siteBuilds = pgTable("site_builds", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * ワーカーがデプロイフックを呼べた時刻。空のあいだは、次の Cron で起動し直す。
   * 内容が変わらずビルドしなかった行（unchanged）は、起動するものが無いので作った時刻を入れる
   */
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  /** ワーカーに起動を頼んだ回数（最初の1回を含む） */
  attempts: integer("attempts").notNull().default(1),
});

// ---------------------------------------------------------------------------
// ユーザー・wiki のメンバー・招待（管理画面に入れる人）
// ---------------------------------------------------------------------------

/**
 * 管理画面に入れる人。Google のアカウント ID（sub）で見分ける。
 * 行を消さない（外した人が書いた版や履歴を残すため）。
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Google のアカウント ID。ADMIN_EMAILS からの移行と締め出し用のスクリプトで作った行は、最初のログインまで空 */
    googleSub: text("google_sub").unique(),
    /** 表示用。ログインのたびに Google から受け取ったもので更新する（小文字） */
    email: text("email").notNull(),
    name: text("name"),
    /** Google アカウントの画像の URL（https のみ）。ログインのたびに更新する。無ければ空 */
    pictureUrl: text("picture_url"),
    /** すべての wiki に管理者として入れ、wiki の作成・アーカイブとオーナーの追加・解除ができる */
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

/**
 * ログインしている端末ごとのセッション。Cookie の署名付きトークンにこの行の ID を入れ、リクエストのたびに行があるかを確かめる。
 * ログアウトでその端末の行を、「ほかの端末からログアウト」でそれ以外の行を消すと、Cookie が残っていても次のリクエストから通らない。
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** Cookie の期限と同じ。過ぎた行は通さず、その人が次にログインしたときに消す */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** wiki ごとのメンバー。オーナーは行が無くても、すべての wiki に管理者として入れる。 */
export const wikiMembers = pgTable(
  "wiki_members",
  {
    wikiId: wikiId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["admin", "editor"] }).notNull(),
    createdAt: createdAt(),
    /** 参加に使った招待。招待を通さずに入った人（wiki を作ったオーナー・移行）は null */
    inviteId: uuid("invite_id").references((): AnyPgColumn => invites.id),
  },
  (t) => [
    primaryKey({ columns: [t.wikiId, t.userId] }),
    check("wiki_members_role_check", sql`${t.role} in ('admin', 'editor')`),
    index("wiki_members_user_idx").on(t.userId),
  ],
);

/** 招待リンク。1リンクで1人、期限つき。値そのものは持たず、ハッシュだけを持つ。 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    role: text("role", { enum: ["admin", "editor"] }).notNull(),
    /** リンクの値（128bit の乱数）の SHA-256（16進） */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedBy: uuid("used_by").references(() => users.id),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check("invites_role_check", sql`${t.role} in ('admin', 'editor')`),
    index("invites_wiki_idx").on(t.wikiId),
  ],
);

/**
 * wiki につないだ SNS のアカウント（いまは X だけ）。wiki と SNS の組に1つ。
 * トークンは `SNS_TOKEN_KEY` で暗号化して持つ（`sns/crypto.ts`）。同じアカウントを複数の wiki につないでもよい。
 */
export const wikiSnsAccounts = pgTable(
  "wiki_sns_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    provider: text("provider", { enum: ["x"] }).notNull(),
    /** SNS の側のアカウント ID（ユーザー名が変わっても同じ） */
    externalId: text("external_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    /** 更新用のトークン。使うたびに新しいものに置き換わる */
    refreshTokenEnc: text("refresh_token_enc"),
    /** アクセストークンの期限 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scopes: text("scopes").notNull(),
    connectedBy: uuid("connected_by").references(() => users.id),
    /** つないだ人の名前（無ければメールアドレス）。その時点の値 */
    connectedByLabel: text("connected_by_label").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("wiki_sns_accounts_wiki_provider_key").on(t.wikiId, t.provider),
    check("wiki_sns_accounts_provider_check", sql`${t.provider} in ('x')`),
  ],
);

// ---------------------------------------------------------------------------
// 監査ログ（誰が・いつ・何をしたか）。追記だけ。直す・消す API は無い
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 全体にかかわる操作（ログイン・オーナーの変更・wiki の作成とアーカイブ）は null */
    wikiId: text("wiki_id").references(() => wikis.id),
    actorType: text("actor_type", { enum: ["user", "system"] }).notNull(),
    /** 人のとき。ログインの拒否は、ユーザーの行が無いので null */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** その時点の名前（無ければメールアドレス）。システムなら「システム」 */
    actorLabel: text("actor_label").notNull(),
    /** その時点のメールアドレス（人のとき） */
    actorEmail: text("actor_email"),
    /** 外部のアプリ（MCP）からの操作なら、その時点のアプリの名前 */
    via: text("via"),
    /** 操作の種類（shared の AUDIT_ACTIONS） */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** その時点の対象のタイトル・名前（あとで変わっても、消えても読めるように） */
    targetLabel: text("target_label"),
    /** 変更の前と後など（shared の AuditDetailMap）。本文・招待リンクやトークンの値・シークレットは入れない */
    detail: jsonb("detail").notNull().default({}),
    /** ログイン・ログインの拒否のときだけ */
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    check("audit_logs_actor_type_check", sql`${t.actorType} in ('user', 'system')`),
    index("audit_logs_wiki_created_idx").on(t.wikiId, t.createdAt, t.id),
    index("audit_logs_created_idx").on(t.createdAt, t.id),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
  ],
);

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
    /** 許可した人。どの wiki のメンバーでもなくなると、この許可も使えなくなる */
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
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
  (t) => [index("oauth_grants_user_idx").on(t.userId, t.createdAt)],
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
/**
 * 外部の URL の OGP（タイトル・説明・画像・サイト名）の取得結果。`GET /link-preview` と、公開時の保存が使う。
 * 取れなかった URL も `ok = false` で残し、短い間は取り直さない（期限は linkPreview/service.ts）。
 * 画像は URL だけを持ち、ファイルそのものは保存しない。
 */
export const linkPreviews = pgTable("link_previews", {
  url: text("url").primaryKey(),
  ok: boolean("ok").notNull(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  siteName: text("site_name"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

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
