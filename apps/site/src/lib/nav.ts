// ツリーナビの形と、最初の表示の決まり。読む人のブラウザでも動く（TreeNav.tsx）ので、ビルド用のもの（@wiki/shared など）は読み込まない

export type NavItem = {
  nodeId: string;
  title: string;
  /** アイコン（絵文字1つ）。付けていなければ null */
  icon: string | null;
  href: string;
  children: NavItem[];
  /**
   * 子があるが、ここには入れていない（ページの HTML に入れる、最初の表示の分だけのツリー）。
   * 子は、ツリー全体（`/nav.{hash}.json`）を読み込むと出せる
   */
  more?: true;
};

/** `/nav.{hash}.json` の中身。wiki ごとに1つで、ツリーの key ごとにツリー全体を持つ。公開ページだけが入る。 */
export type NavData = { trees: Record<string, NavItem[]> };

/**
 * 広い画面で、左の列（サイドバー）を閉じたことを覚える localStorage のキー。閉じている間だけ `SIDEBAR_CLOSED` が入る。
 * 描く前に読むのは Base.astro、書くのは NavDrawer.astro
 */
export const SIDEBAR_STORAGE_KEY = "wiki:sidebar";
export const SIDEBAR_CLOSED = "closed";

/** そのノードか、その下のどこかに nodeId があるか。 */
export function containsNode(item: NavItem, nodeId: string | undefined): boolean {
  return item.nodeId === nodeId || item.children.some((c) => containsNode(c, nodeId));
}

/** ツリーナビを出したときに、最初から開いているノードか（最上位と、現在地までの道筋）。 */
export function initiallyOpen(item: NavItem, depth: number, current: string | undefined): boolean {
  return depth === 0 || containsNode(item, current);
}

/**
 * ツリーのうち、最初の表示に出る分だけを返す（ページの HTML に入れる分）。
 * 出るのは、最上位とその子、現在地までの祖先とその兄弟、現在地の子。閉じているノードの子は落とし、`more` を立てる。
 * `openIds` は、現在地とその祖先の nodeId（ancestors で作る）。
 */
export function initialNavItems(items: readonly NavItem[], openIds: ReadonlySet<string> = new Set()): NavItem[] {
  const prune = (item: NavItem, depth: number): NavItem => {
    if (item.children.length === 0) return item;
    if (depth === 0 || openIds.has(item.nodeId)) return { ...item, children: item.children.map((c) => prune(c, depth + 1)) };
    return { ...item, children: [], more: true };
  };
  return items.map((item) => prune(item, 0));
}
