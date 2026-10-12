/**
 * 並んだ要素から、消える要素のあとにフォーカスを渡す先を選ぶ。次の要素、無ければ前の要素。
 * `items` は並び順（消える要素を含む）。
 */
export function pickNeighbor<T>(items: readonly T[], isRemoved: (item: T) => boolean): T | undefined {
  const first = items.findIndex(isRemoved);
  if (first < 0) return undefined;
  const remaining = items.map((item, i) => ({ item, i })).filter(({ item }) => !isRemoved(item));
  return (remaining.find(({ i }) => i > first) ?? [...remaining].reverse().find(({ i }) => i < first))?.item;
}

/** フォーカスが行き場を失っている（押したボタンが消えて body に落ちた）か。 */
const lost = () => {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
};

/**
 * 行が消える操作のあとに、フォーカスを近くへ移す準備をする。行が消える前（押した時点）に呼び、戻り値を、一覧が更新されたあとに呼ぶ。
 * 次の行、無ければ前の行の `focusSelector`（リンクなど）へ。一覧が空になったら `fallback`（見出しなど）へ。
 * フォーカスを別の場所へ移していたときは、動かさない。
 */
export function focusAfterRemoval(
  removed: Element | null | undefined,
  options: { scope: Element | null | undefined; focusSelector: string; fallback?: () => HTMLElement | null },
): () => void {
  const items = options.scope && removed ? [...options.scope.querySelectorAll<HTMLElement>(options.focusSelector)] : [];
  const neighbor = pickNeighbor(items, (el) => !!removed?.contains(el));
  return () => {
    // 消えた行へフォーカスを戻す動き（メニュー・ダイアログを閉じる）が落ち着いてから見る
    setTimeout(() => {
      if (!lost()) return;
      const target = neighbor?.isConnected && !neighbor.hasAttribute("disabled") ? neighbor : options.fallback?.();
      target?.focus();
    }, 50);
  };
}

/** 画面に出るのを待って、`selector` の要素にフォーカスを移す（最大 1 秒）。 */
export function focusWhenReady(selector: string) {
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.focus();
    else if (++tries < 20) setTimeout(attempt, 50);
  };
  setTimeout(attempt, 50);
}
