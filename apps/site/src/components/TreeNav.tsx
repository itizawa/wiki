import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { initiallyOpen, type NavData, type NavItem } from "../lib/nav";
import s from "./TreeNav.module.css";

/** ツリー全体の読み込みの状態。`src` を渡さないときは、はじめから全部を持っているので loaded */
type Load = "idle" | "loading" | "loaded" | "failed";

type Props = {
  /**
   * 最初に描くツリー。`src` を渡すページでは、最初の表示に出る分だけ（lib/nav.ts の initialNavItems）。
   * 閉じているノードの子は入っていない（`more`）
   */
  items: NavItem[];
  current?: string;
  /** ツリー全体（NavData）の URL。渡すと、動き出したあとに取りに行き、届いたら `items` と入れ替える */
  src?: string;
  /** `src` の中の、どのツリーを使うか */
  treeKey?: string;
};

/**
 * ツリーナビ（アイランド）。現在地を含むページは開いた状態で始まる。
 * ページの HTML には最初の表示の分だけを入れ、残りは `src`（wiki ごとに1つの JSON）から読む。
 * 読み込めなくても、最初の分のリンクでそのまま移れる。
 */
export default function TreeNav({ items: initial, current, src, treeKey }: Props) {
  const [items, setItems] = useState(initial);
  const [load, setLoad] = useState<Load>(src ? "idle" : "loaded");
  const inFlight = useRef(false);

  const loadAll = useCallback(async () => {
    if (!src || inFlight.current) return;
    inFlight.current = true;
    setLoad("loading");
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src}: ${res.status}`);
      const all = ((await res.json()) as Partial<NavData>).trees?.[treeKey ?? ""];
      if (!Array.isArray(all)) throw new Error(`${src}: no tree ${treeKey}`);
      // nodeId が同じノードは同じ部品のまま残るので、開閉の状態は変わらない
      setItems(all);
      setLoad("loaded");
    } catch {
      setLoad("failed");
    } finally {
      inFlight.current = false;
    }
  }, [src, treeKey]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <ul className={s.nav}>
      {items.map((item) => (
        <Node key={item.nodeId} item={item} current={current} depth={0} load={load} onLoad={loadAll} />
      ))}
    </ul>
  );
}

function Node({ item, current, depth, load, onLoad }: { item: NavItem; current?: string; depth: number; load: Load; onLoad: () => void }) {
  const [open, setOpen] = useState(initiallyOpen(item, depth, current));
  /** 子があるが、まだ読み込めていない */
  const pending = item.more === true && item.children.length === 0;
  const hasChildren = item.children.length > 0 || pending;
  const toggle = () => {
    // 前に読み込めなかったときは、開く操作でもう一度取りに行く
    if (!open && pending && load === "failed") onLoad();
    setOpen(!open);
  };
  return (
    <li>
      <div className={item.nodeId === current ? s.current : s.item}>
        {hasChildren ? (
          <button className={s.twisty} aria-expanded={open} aria-label={open ? "閉じる" : "開く"} onClick={toggle}>
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span className={s.twisty} />
        )}
        <a href={item.href} aria-current={item.nodeId === current ? "page" : undefined}>
          {/* 飾りなので読み上げない（タイトルだけを読む） */}
          {item.icon && (
            <span className={s.icon} aria-hidden="true">
              {item.icon}
            </span>
          )}
          {item.title}
        </a>
      </div>
      {hasChildren && open && (
        <ul>
          {item.children.map((c) => (
            <Node key={c.nodeId} item={c} current={current} depth={depth + 1} load={load} onLoad={onLoad} />
          ))}
          {pending && (
            <li className={s.status} role="status">
              {load === "failed" ? (
                <>
                  下のページを読み込めませんでした。
                  <button type="button" className={s.retry} onClick={onLoad}>
                    もう一度読み込む
                  </button>
                </>
              ) : (
                "読み込み中…"
              )}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
