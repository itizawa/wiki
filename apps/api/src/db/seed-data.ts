import { pagePath } from "@wiki/shared";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { publishPage } from "../publishing/service";
import { createPage } from "../routes/pages";
import { bootstrapStructure } from "../structure/repo";
import { createWiki, DEFAULT_WIKI_KEY } from "../wikis/service";
import type { Db } from "./client";
import * as schema from "./schema";
import { pages, pageVersions, scheduledActions, wikis } from "./schema";

const DAY = 24 * 3600_000;

type SeedPage = {
  title: string;
  /** 本文。`{{キー}}` は先に作ったページの `/p/{id}` に置き換える */
  body: string;
  /** 本文中から参照するための名前 */
  key?: string;
  /** 公開状態。省略時は非公開（下書き） */
  state?: "public" | "unlisted" | "scheduled";
  /** 公開日を何日前にするか（public のみ） */
  daysAgo?: number;
  /** 記事の状態。省略時は draft */
  workflow?: "idea" | "approved";
  /** 保存し直して版を増やす（公開済みなら「公開後に編集あり」の状態になる） */
  revisedBody?: string;
  children?: SeedPage[];
};

/** ローカル確認用のデータ。階層3段、公開・限定公開・予約・下書き、記事の状態（ネタ・承認済み）、版の履歴、内部リンクを一通り含む。 */
const SEED: SeedPage[] = [
  {
    key: "intro",
    title: "はじめに",
    state: "public",
    daysAgo: 30,
    body: "# ようこそ\n\nこの wiki は、書いたページをそのまま公開できる場所です。\n\n- ページの下にページを置いて階層を作ります\n- フォルダはありません。まとめ役が欲しければ、それもページとして書きます",
    children: [
      {
        key: "howto",
        title: "この wiki の使い方",
        state: "public",
        daysAgo: 28,
        body: "## 基本の流れ\n\n1. サイドバーの「＋」でページを作る\n2. 書く\n3. 公開する\n\nまずは [はじめに]({{intro}}) を読んでください。",
        children: [
          {
            key: "write",
            title: "ページを書く",
            state: "public",
            daysAgo: 21,
            body: "## 書き方\n\n本文は Markdown で保存されます。\n\n| 記法 | 例 |\n|---|---|\n| 見出し | `## 見出し` |\n| リスト | `- 項目` |\n\n```ts\nconst hello = \"world\";\n```",
            revisedBody: "## 書き方\n\n本文は Markdown で保存されます。画像や表も使えます。\n\n| 記法 | 例 |\n|---|---|\n| 見出し | `## 見出し` |\n| リスト | `- 項目` |\n\n```ts\nconst hello = \"world\";\n```\n\n（この段落は公開後に書き足した、まだ公開していない変更です）",
          },
          {
            title: "公開と予約",
            state: "scheduled",
            body: "## 公開範囲\n\n- 公開：誰でも読める\n- 限定公開：URL を知っている人だけ\n- 非公開：管理画面だけ\n\n予約すると、指定した時刻の版がそのまま公開されます。書き方は [ページを書く]({{write}}) を参照。",
          },
          {
            title: "ツリーを整理する",
            body: "サイドバーでドラッグすると並び替えられます。行に重ねて落とすと、そのページの下に入ります。",
          },
        ],
      },
      {
        title: "よくある質問",
        state: "unlisted",
        body: "## URL は変わりますか\n\n変わりません。ページを別の場所へ移しても `/p/{id}` のままです。\n\n## 削除したら\n\n公開していたページは「削除されました」と表示されます。",
      },
    ],
  },
  {
    title: "開発メモ",
    state: "public",
    daysAgo: 15,
    body: "開発まわりのメモをこの下にまとめる。",
    children: [
      {
        key: "design",
        title: "設計",
        state: "public",
        daysAgo: 14,
        body: "## 方針\n\nツリーは1本。ノードはすべてページ。\n\n詳しくは下のページへ。",
        children: [
          {
            key: "hierarchy",
            title: "ツリーとページの階層",
            state: "public",
            daysAgo: 7,
            body: "## 階層\n\nページの下にページを置く。配下のページには、親と同じか、より狭い公開範囲しか設定できない（親が非公開なら、子は公開できない）。\n\n関連：[設計]({{design}})",
          },
          {
            title: "公開パイプライン",
            workflow: "approved",
            body: "## 流れ（下書き）\n\n操作 → publish_events → ワーカーがデバウンス → ビルド\n\nTODO: 図を入れる。[ツリーとページの階層]({{hierarchy}}) と合わせて読めるようにする。",
          },
        ],
      },
      {
        title: "議事録",
        body: "定例の記録。",
        children: [
          { title: "2026-10-01 定例", body: "- フォルダと Inbox をやめる\n- URL は `/p/{id}` だけにする" },
          { title: "2026-10-08 定例", body: "- テストデータを用意する\n- 次回：ルールエンジン" },
        ],
      },
    ],
  },
  {
    title: "下書き置き場",
    body: "",
    children: [
      { title: "ネタ：予約投稿の運用", workflow: "idea", body: "週2本、火曜と金曜の朝に出す案。" },
      { title: "無題", body: "" },
    ],
  },
  {
    title: "お知らせ",
    state: "public",
    daysAgo: 2,
    body: "## サイトを公開しました\n\n最初は [はじめに]({{intro}}) からどうぞ。おすすめの本は [こちら](https://example.com/book)。",
  },
];

/** 2つめの wiki。wiki を切り替えても内容が混ざらないことを確かめるためのもの。 */
export const SECOND_WIKI = { key: "notes", name: "開発ノート" };

const SECOND_SEED: SeedPage[] = [
  {
    key: "about",
    title: "このノートについて",
    state: "public",
    daysAgo: 10,
    body: "# 開発ノート\n\n開発中に調べたことを置く、2つめの wiki です。最初の wiki とは、ページもツリーもルールも別です。",
    children: [
      {
        title: "Cloudflare Workers のメモ",
        state: "public",
        daysAgo: 5,
        body: "## 静的アセット\n\n`run_worker_first` で、アセットより先に Worker を通せる。\n\n[このノートについて]({{about}}) に戻る。",
      },
      { title: "共有前のメモ", state: "unlisted", body: "URL を知っている人だけが読めるメモ。" },
    ],
  },
  { title: "あとで書く", workflow: "idea", body: "ビルド時間を測る。" },
];

/**
 * テスト用のデータを投入する。ページが1件でもあれば何もせずに失敗する（先に resetDatabase を呼ぶ）。
 * 最初の wiki と、2つめの wiki（SECOND_WIKI）に入れる。
 */
export async function seedDatabase(db: Db, now = new Date()): Promise<{ pages: number }> {
  await bootstrapStructure(db);
  const [existing] = await db.select({ id: pages.id }).from(pages).limit(1);
  if (existing) throw new Error("the database already has pages; reset it first (pnpm db:seed --reset)");

  const first = await ensureDefaultWiki(db);
  const [second] = await db.select().from(wikis).where(eq(wikis.key, SECOND_WIKI.key));
  const secondId = (second ?? (await createWiki(db, SECOND_WIKI, null))).id;
  const count = (await seedWiki(db, first, SEED, now)) + (await seedWiki(db, secondId, SECOND_SEED, now));
  return { pages: count };
}

/** 最初の wiki（マイグレーションが作る）の id を返す。無ければ作る。 */
async function ensureDefaultWiki(db: Db): Promise<string> {
  const [wiki] = await db.select().from(wikis).where(eq(wikis.key, DEFAULT_WIKI_KEY));
  return (wiki ?? (await createWiki(db, { key: DEFAULT_WIKI_KEY, name: "メイン" }, null))).id;
}

async function seedWiki(db: Db, wikiId: string, seed: SeedPage[], now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const paths = new Map<string, string>();
    const fill = (body: string) =>
      body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
        const path = paths.get(key);
        if (!path) throw new Error(`seed page "${key}" is referenced before it is created`);
        return path;
      });
    let count = 0;

    const add = async (page: SeedPage, parentPageId: string | null) => {
      const id = await createPage(tx, wikiId, { title: page.title, bodyMd: fill(page.body), parentPageId });
      count++;
      if (page.key) paths.set(page.key, pagePath(id));
      const [row] = await tx.select().from(pages).where(eq(pages.id, id));
      const versionId = row!.headVersionId;

      if (page.state === "public" || page.state === "unlisted") {
        await publishPage(tx, {
          wikiId,
          pageId: id,
          versionId,
          visibility: page.state,
          publishedAt: new Date(now.getTime() - (page.daysAgo ?? 0) * DAY),
        });
      } else if (page.state === "scheduled") {
        await tx.insert(scheduledActions).values({
          wikiId,
          actionType: "publish_page",
          pageId: id,
          versionId,
          targetVisibility: "public",
          runAt: new Date(now.getTime() + 3 * DAY),
        });
      }

      if (page.workflow === "approved") {
        await tx.update(pages).set({ workflowState: "approved", approvedVersionId: versionId, approvedAt: now }).where(eq(pages.id, id));
      } else if (page.workflow) {
        await tx.update(pages).set({ workflowState: page.workflow }).where(eq(pages.id, id));
      }

      if (page.revisedBody !== undefined) {
        const [version] = await tx
          .insert(pageVersions)
          .values({ pageId: id, baseVersionId: versionId, title: page.title, bodyMd: fill(page.revisedBody), authorType: "human" })
          .returning({ id: pageVersions.id });
        await tx.update(pages).set({ headVersionId: version!.id }).where(eq(pages.id, id));
      }

      for (const child of page.children ?? []) await add(child, id);
    };
    for (const page of seed) await add(page, null);
    return count;
  });
}

/** すべてのテーブルを空にして、最初の wiki と空のツリーだけがある初期状態に戻す。 */
export async function resetDatabase(db: Db): Promise<void> {
  const tables = Object.values(schema)
    .flatMap((t) => (is(t, PgTable) ? [`"${getTableName(t)}"`] : []));
  await db.execute(sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`));
  await ensureDefaultWiki(db);
}
