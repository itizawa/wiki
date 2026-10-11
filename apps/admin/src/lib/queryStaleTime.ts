/** 取ってから、この時間（ms）は取り直さない。 */
export const STALE_MS = 30_000;

/**
 * 画面を移るたびに取り直さないクエリ（キーの先頭）。
 * どの画面でも出していて、変えたあとは `invalidateQueries` で読み直しているものだけを入れる。
 * ここに入れると、ほかの人・ほかのタブ・外部アプリ（MCP）からの変更が、最大 `STALE_MS` だけ遅れて見える。
 * 編集画面の本文（`page`）と下書き（`draft`）のように、開くたびに最新が要るものは入れない。
 */
const KEPT_FRESH: ReadonlySet<unknown> = new Set(["structure", "pages", "wikis", "me", "templates"]);

/** クエリのキーから、取り直さずに使う時間（ms）を決める。`KEPT_FRESH` に無いものは 0（今までどおり、出すたびに取り直す）。 */
export function staleTimeFor(queryKey: readonly unknown[]): number {
  return KEPT_FRESH.has(queryKey[0]) ? STALE_MS : 0;
}
