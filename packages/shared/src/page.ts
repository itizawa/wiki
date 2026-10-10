import { z } from "zod";
import type { WorkflowState } from "./rules";

export const visibilitySchema = z.enum(["public", "unlisted", "private"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const pageOriginSchema = z.enum(["human", "ai_draft"]);
export const authorTypeSchema = z.enum(["human", "ai"]);
export type AuthorType = z.infer<typeof authorTypeSchema>;

export const createPageInput = z
  .object({
    /** テンプレートから作るときは省略でき、テンプレートのタイトル（変数を置き換えたもの）になる */
    title: z.string().trim().min(1).max(200).optional(),
    bodyMd: z.string().max(500_000).default(""),
    /** この下に置く親ページ。省略またはnullなら最上位。どちらも兄弟の末尾に置く。 */
    parentPageId: z.string().min(1).max(64).nullable().optional(),
    /** 本文をこのテンプレート（変数を置き換えたもの）で始める。bodyMd は使わない */
    templateId: z.string().uuid().optional(),
  })
  .refine((v) => v.title !== undefined || v.templateId !== undefined, { message: "title is required", path: ["title"] });
export type CreatePageInput = z.infer<typeof createPageInput>;

/** 本文の保存。baseVersionIdが現在のheadと一致する場合のみ保存できる（楽観ロック）。 */
export const savePageInput = z.object({
  baseVersionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(500_000),
});
export type SavePageInput = z.infer<typeof savePageInput>;

export type PageSummary = {
  id: string;
  title: string;
  headVersionId: string;
  publishedVersionId: string | null;
  visibility: Visibility;
  origin: "human" | "ai_draft";
  unlistedKey: string | null;
  firstPublishedAt: string | null;
  workflowState: WorkflowState;
  /** 承認した版。承認後に編集があると headVersionId と異なる */
  approvedVersionId: string | null;
  /** 見直しキューに入った日時。入っていなければ null */
  reviewRequestedAt: string | null;
  updatedAt: string;
};

export type PageVersion = {
  id: string;
  pageId: string;
  baseVersionId: string | null;
  title: string;
  bodyMd: string;
  authorType: AuthorType;
  createdAt: string;
};

export type PageDetail = PageSummary & { head: PageVersion };
