import { pagePath } from "@wiki/shared";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { publishPage } from "../publishing/service";
import { createPage } from "../routes/pages";
import { bootstrapStructure } from "../structure/repo";
import type { Db } from "./client";
import * as schema from "./schema";
import { pages, pageVersions, scheduledActions } from "./schema";

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
  /** 保存し直して版を増やす（公開済みなら「公開後に編集あり」の状態になる） */
  revisedBody?: string;
  children?: SeedPage[];
};

/** ローカル確認用のデータ。階層3段、公開・限定公開・予約・下書き、版の履歴、内部リンクを一通り含む。 */
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
            body: "## 階層\n\nページの下にページを置く。親が非公開でも、公開している子は公開サイトに出る（一つ上の公開ページの下に繰り上がる）。\n\n関連：[設計]({{design}})",
          },
          {
            title: "公開パイプライン",
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
      { title: "ネタ：予約投稿の運用", body: "週2本、火曜と金曜の朝に出す案。" },
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

/**
 * テスト用のデータを投入する。ページが1件でもあれば何もせずに失敗する（先に resetDatabase を呼ぶ）。
 */
export async function seedDatabase(db: Db, now = new Date()): Promise<{ pages: number }> {
  await bootstrapStructure(db);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: pages.id }).from(pages).limit(1);
    if (existing) throw new Error("the database already has pages; reset it first (pnpm db:seed --reset)");

    const paths = new Map<string, string>();
    const fill = (body: string) =>
      body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
        const path = paths.get(key);
        if (!path) throw new Error(`seed page "${key}" is referenced before it is created`);
        return path;
      });
    let count = 0;

    const add = async (page: SeedPage, parentPageId: string | null) => {
      const id = await createPage(tx, { title: page.title, bodyMd: fill(page.body), parentPageId });
      count++;
      if (page.key) paths.set(page.key, pagePath(id));
      const [row] = await tx.select().from(pages).where(eq(pages.id, id));
      const versionId = row!.headVersionId;

      if (page.state === "public" || page.state === "unlisted") {
        await publishPage(tx, {
          pageId: id,
          versionId,
          visibility: page.state,
          publishedAt: new Date(now.getTime() - (page.daysAgo ?? 0) * DAY),
        });
      } else if (page.state === "scheduled") {
        await tx.insert(scheduledActions).values({
          actionType: "publish_page",
          pageId: id,
          versionId,
          targetVisibility: "public",
          runAt: new Date(now.getTime() + 3 * DAY),
        });
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
    for (const page of SEED) await add(page, null);
    return { pages: count };
  });
}

/** すべてのテーブルを空にして、空のツリーだけがある初期状態に戻す。 */
export async function resetDatabase(db: Db): Promise<void> {
  const tables = Object.values(schema)
    .flatMap((t) => (is(t, PgTable) ? [`"${getTableName(t)}"`] : []));
  await db.execute(sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`));
  await bootstrapStructure(db);
}
