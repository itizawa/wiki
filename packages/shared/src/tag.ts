import { z } from "zod";

/**
 * 管理用タグ：ページに付ける、管理のためのラベル。公開サイトには出さない。
 * wiki ごとに管理者が作り、ページへの付け外しは編集者以上ができる。
 */

export const TAG_NAME_MAX = 40;

/** タグ名。前後の空白は落とし、空白だけは不可。同じ wiki の中で重ならない（重なりは API が 409 で返す） */
export const tagNameSchema = z.string().trim().min(1, "タグ名を入力してください").max(TAG_NAME_MAX, `タグ名は${TAG_NAME_MAX}文字までです`);

export const createTagInput = z.object({ name: tagNameSchema });
export type CreateTagInput = z.infer<typeof createTagInput>;

export const renameTagInput = z.object({ name: tagNameSchema });
export type RenameTagInput = z.infer<typeof renameTagInput>;

/** ページに付いているタグ */
export type PageTag = { id: string; name: string };

/** wiki のタグ一覧の1件。pageCount は、付いているページの数（ゴミ箱のページは数えない） */
export type WikiTag = PageTag & { pageCount: number; createdAt: string };

/** `GET /admin/w/{key}/tags` */
export type TagList = { tags: WikiTag[] };

/** タグを付け外ししたあとの、そのページのタグ（名前順） */
export type PageTagList = { tags: PageTag[] };
