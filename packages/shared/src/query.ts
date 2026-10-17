import { z } from "zod";

/** 問い合わせの、カンマ区切りの値（`a,b`）を配列にする。空の要素は捨てる。1つも無いか、`max` を超えれば通さない */
export const csvQuery = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .string()
    .transform((s) => s.split(",").filter((x) => x !== ""))
    .pipe(z.array(item).min(1).max(max));

/** 一覧の日時の並び。省くと新しい順 */
export const listOrder = z.enum(["desc", "asc"]).default("desc");
export type ListOrder = z.infer<typeof listOrder>;
