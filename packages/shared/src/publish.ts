import { z } from "zod";
import type { WikiHome } from "./home";
import type { WikiTheme } from "./theme";

/** 公開操作で選べる公開範囲（private は「非公開化」で扱う）。 */
export const publishVisibilitySchema = z.enum(["public", "unlisted"]);
export type PublishVisibility = z.infer<typeof publishVisibilitySchema>;

export const publishPageInput = z.object({
  versionId: z.string().uuid(),
  visibility: publishVisibilitySchema,
  /** 配下の公開中のページも同じ公開範囲にする（まだ公開していないページは飛ばす） */
  applyToDescendants: z.boolean().default(false),
});
export type PublishPageInput = z.input<typeof publishPageInput>;

/** 非公開化。本文は省略できる。 */
export const unpublishPageInput = z.object({
  /** 配下の公開中・限定公開中のページもまとめて非公開にする */
  applyToDescendants: z.boolean().default(false),
});
export type UnpublishPageInput = z.input<typeof unpublishPageInput>;

const runAt = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

/** 予約。publish_page は予約時点の版を固定する（予約後の編集は含めない）。 */
export const scheduleActionInput = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("publish_page"),
    pageId: z.string().min(1),
    versionId: z.string().uuid(),
    targetVisibility: publishVisibilitySchema.default("public"),
    runAt,
    batchId: z.string().uuid().optional(),
  }),
  z.object({
    actionType: z.literal("unpublish_page"),
    pageId: z.string().min(1),
    runAt,
    batchId: z.string().uuid().optional(),
  }),
]);
export type ScheduleActionInput = z.infer<typeof scheduleActionInput>;

export const rescheduleInput = z.object({ runAt });

export type ScheduledActionStatus = "scheduled" | "running" | "done" | "failed" | "canceled";

export type ScheduledAction = {
  id: string;
  actionType: "publish_page" | "unpublish_page" | "merge_branch";
  pageId: string | null;
  pageTitle: string | null;
  versionId: string | null;
  targetVisibility: PublishVisibility | null;
  branchName: string | null;
  batchId: string | null;
  runAt: string;
  status: ScheduledActionStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  executedAt: string | null;
  /** 予約後にページが編集された（予約内容には反映されない） */
  editedAfterSchedule: boolean;
};

// ---------------------------------------------------------------------------
// 公開ビルド用マニフェスト（/export/public）
// ---------------------------------------------------------------------------

export type ManifestPage = {
  id: string;
  path: string;
  title: string;
  /** アイコン（絵文字1つ）。付けていなければ null */
  icon: string | null;
  bodyMd: string;
  firstPublishedAt: string;
  /** 公開版の作成日時（改訂日） */
  revisedAt: string;
  monetization: Record<string, unknown> | null;
};

/** 限定公開ページ。id は出さない（URLを知る人だけが到達できるようにする）。 */
export type ManifestUnlistedPage = {
  key: string;
  path: string;
  title: string;
  icon: string | null;
  bodyMd: string;
  revisedAt: string;
};

export type ManifestTreeNode = {
  nodeId: string;
  pageId: string;
  parentNodeId: string | null;
  position: string;
};

export type ManifestTree = {
  key: string;
  isPrimary: boolean;
  nodes: ManifestTreeNode[];
};

/** 1つの wiki の公開内容。公開サイトでは wiki ごとのディレクトリに出力する。 */
export type WikiManifest = {
  /** サブドメイン（`{key}.{baseDomain}`） */
  key: string;
  /** 公開サイトの名前 */
  name: string;
  /** 公開サイトの見た目（既定で埋めたもの）。ビルドのときに CSS 変数・ロゴ・ファビコンとして出す */
  theme: WikiTheme;
  /** 公開サイトのトップの設定（既定で埋めたもの）。自由記述は新着記事の上に出す */
  home: WikiHome;
  /** Google Analytics（GA4）の測定 ID。null なら Google タグを出さない */
  gaMeasurementId: string | null;
  /** Google サーチコンソールの確認用の値。null なら確認用の meta を出さない */
  searchConsoleVerification: string | null;
  headCommitId: string;
  pages: ManifestPage[];
  unlisted: ManifestUnlistedPage[];
  trees: ManifestTree[];
  /** 公開後に削除された記事の id（410） */
  gone: string[];
};

export type PublicManifest = {
  generatedAt: string;
  /** generatedAt を除いた、全 wiki の内容のハッシュ。変わらなければビルドを省略できる */
  contentHash: string;
  /** アーカイブ中の wiki は含めない */
  wikis: WikiManifest[];
};
