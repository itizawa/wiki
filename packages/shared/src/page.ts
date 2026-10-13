import { z } from "zod";
import { pageCoverSchema } from "./cover";
import { pageIconSchema } from "./emoji";
import type { PageTag } from "./tag";

/** ページのタイトルの長さの上限（文字数）。API の検証と、管理画面の入力欄の表示で同じ値を使う */
export const PAGE_TITLE_MAX = 200;

export const visibilitySchema = z.enum(["public", "unlisted", "private"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const pageOriginSchema = z.enum(["human", "ai_draft"]);
export const authorTypeSchema = z.enum(["human", "ai"]);
export type AuthorType = z.infer<typeof authorTypeSchema>;

export const createPageInput = z
  .object({
    /** テンプレートから作るときは省略でき、テンプレートのタイトル（変数を置き換えたもの）になる */
    title: z.string().trim().min(1).max(PAGE_TITLE_MAX).optional(),
    bodyMd: z.string().max(500_000).default(""),
    /** この下に置く親ページ。省略またはnullなら最上位。どちらも兄弟の末尾に置く。 */
    parentPageId: z.string().min(1).max(64).nullable().optional(),
    /** 本文をこのテンプレート（変数を置き換えたもの）で始める。bodyMd は使わない */
    templateId: z.string().uuid().optional(),
    /** アイコン（絵文字1つ）。省略または null なら付けない */
    icon: pageIconSchema.nullable().optional(),
    /** カバー画像（`/images/{name}` か用意した画像）。省略または null なら付けない */
    cover: pageCoverSchema.nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.templateId !== undefined, { message: "title is required", path: ["title"] });
export type CreatePageInput = z.infer<typeof createPageInput>;

/** 本文の保存。baseVersionIdが現在のheadと一致する場合のみ保存できる（楽観ロック）。 */
export const savePageInput = z.object({
  baseVersionId: z.string().uuid(),
  title: z.string().trim().min(1).max(PAGE_TITLE_MAX),
  bodyMd: z.string().max(500_000),
});
export type SavePageInput = z.infer<typeof savePageInput>;

/**
 * 下書きの自動保存。版は作らない。baseVersionId が現在の head と一致する場合のみ保存できる。
 * タイトルは打ちかけで空のこともあるので、空でも受け付ける（版にするときに確かめる。空のあいだは版にならない）。
 */
export const savePageDraftInput = z.object({
  baseVersionId: z.string().uuid(),
  title: z.string().max(PAGE_TITLE_MAX),
  bodyMd: z.string().max(500_000),
});
export type SavePageDraftInput = z.infer<typeof savePageDraftInput>;

/** 自分の下書き。版になるか破棄するまで、ページを開き直しても続きから書ける。編集が一段落すると、自動で版になる。 */
export type PageDraft = {
  /** 下書きを始めたときの head。いまの head と違えば、その後に別の版ができている */
  baseVersionId: string;
  title: string;
  bodyMd: string;
  updatedAt: string;
};

/** 下書きの自動保存の結果。 */
export type SavePageDraftResult = {
  /** 保存した下書き。head と同じ内容に戻していたら null（下書きは無い） */
  draft: PageDraft | null;
  /** いまの head。送った baseVersionId と違えば、自分の下書きから自動で版ができている */
  headVersionId: string;
};

/** スターの並び替え。渡した順に並べる（スターが付いていない id は無視し、ここに無いスターは後ろに残す）。 */
export const reorderStarsInput = z.object({
  pageIds: z.array(z.string().min(1).max(64)).max(500),
});
export type ReorderStarsInput = z.infer<typeof reorderStarsInput>;

export type PageSummary = {
  id: string;
  title: string;
  /** アイコン（絵文字1つ）。付けていなければ null。版には入らず、変えるとすぐに反映される */
  icon: string | null;
  /** カバー画像のパス（`/images/{name}` か `/covers/{key}.svg`）。付けていなければ null。版には入らず、変えるとすぐに反映される */
  cover: string | null;
  headVersionId: string;
  publishedVersionId: string | null;
  visibility: Visibility;
  origin: "human" | "ai_draft";
  unlistedKey: string | null;
  firstPublishedAt: string | null;
  updatedAt: string;
  /** 付いている管理用タグ（名前順）。公開サイトには出さない */
  tags: PageTag[];
};

export type PageVersion = {
  id: string;
  pageId: string;
  baseVersionId: string | null;
  title: string;
  bodyMd: string;
  authorType: AuthorType;
  /** 版を作った人（いまの名前）。自動でできた版は、もとの下書きを書いていた人。これより前の版は null */
  createdBy: { id: string; name: string } | null;
  /** 間引かずに残す版か。下書きから自動でできた版は false。人が操作して作った版と、公開・予約に使った版は true */
  keep: boolean;
  /** 編集リクエストの提案を採用してできた版なら、採用した項目の数。そうでなければ 0 */
  acceptedItems: number;
  createdAt: string;
};

/** 版履歴の一覧の1行（本文は入れない）。via は、外部のアプリ（MCP）から保存した版なら、そのアプリの名前 */
export type VersionListItem = Pick<PageVersion, "id" | "baseVersionId" | "title" | "authorType" | "createdBy" | "keep" | "acceptedItems" | "createdAt"> & {
  via: string | null;
};

/**
 * 版履歴の一覧（`GET /pages/:id/versions?limit=&cursor=`）。新しい順に、1回に `limit` 件（既定 50、最大 100）。
 * `nextCursor` を次の呼び出しの `cursor` に渡すと続きが返る。null なら、そこで終わり
 */
export type PageVersionList = { versions: VersionListItem[]; nextCursor: string | null };

export type PageDetail = PageSummary & { head: PageVersion };

/** ゴミ箱の1行。いっしょにゴミ箱に入れたページのまとまりを、削除で選んだページ（先頭）で表す。 */
export type TrashedPage = {
  id: string;
  title: string;
  /** ゴミ箱に入れた日時 */
  deletedAt: string;
  /** いっしょにゴミ箱に入れた配下のページ数（先頭のページは数えない） */
  descendantCount: number;
};
