import { useState } from "react";
import type { NavItem } from "../lib/tree";
import s from "./TreeNav.module.css";

function containsNode(item: NavItem, nodeId: string | undefined): boolean {
  return item.nodeId === nodeId || item.children.some((c) => containsNode(c, nodeId));
}

/** ツリーナビ（アイランド）。現在地を含むページは開いた状態で始まる。 */
export default function TreeNav({ items, current }: { items: NavItem[]; current?: string }) {
  return (
    <ul className={s.nav}>
      {items.map((item) => (
        <Node key={item.nodeId} item={item} current={current} depth={0} />
      ))}
    </ul>
  );
}

function Node({ item, current, depth }: { item: NavItem; current?: string; depth: number }) {
  const [open, setOpen] = useState(depth === 0 || containsNode(item, current));
  const hasChildren = item.children.length > 0;
  return (
    <li>
      <div className={item.nodeId === current ? s.current : s.item}>
        {hasChildren ? (
          <button className={s.twisty} aria-expanded={open} aria-label={open ? "閉じる" : "開く"} onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className={s.twisty} />
        )}
        <a href={item.href} aria-current={item.nodeId === current ? "page" : undefined}>
          {item.title}
        </a>
      </div>
      {hasChildren && open && (
        <ul>
          {item.children.map((c) => (
            <Node key={c.nodeId} item={c} current={current} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
