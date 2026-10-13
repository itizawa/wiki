import type { PageTag } from "@wiki/shared";

/** タグを名前順に並べる（API の返す順と同じ。付けた直後の表示を、取り直した結果と揃える）。 */
export function sortTags(tags: readonly PageTag[]): PageTag[] {
  return [...tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** タグを付けた・外したあとのタグ一覧（API の応答が来る前の、見た目だけの先取り）。 */
export function withTag(tags: readonly PageTag[], tag: PageTag, on: boolean): PageTag[] {
  const rest = tags.filter((t) => t.id !== tag.id);
  return on ? sortTags([...rest, tag]) : rest;
}
