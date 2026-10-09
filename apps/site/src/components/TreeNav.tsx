import { useState } from "react";
import type { NavItem } from "../lib/tree";

function containsNode(item: NavItem, nodeId: string | undefined): boolean {
  return item.nodeId === nodeId || item.children.some((c) => containsNode(c, nodeId));
}

/** ツリーナビ（アイランド）。現在地を含むfolderは開いた状態で始まる。 */
export default function TreeNav({ items, current }: { items: NavItem[]; current?: string }) {
  return (
    <ul className="tree-nav">
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
      <div className={`tree-item ${item.nodeId === current ? "current" : ""}`}>
        {hasChildren ? (
          <button className="twisty" aria-expanded={open} aria-label={open ? "閉じる" : "開く"} onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twisty" />
        )}
        {item.href ? (
          <a href={item.href} aria-current={item.nodeId === current ? "page" : undefined}>
            {item.title}
          </a>
        ) : (
          <span className="folder">{item.title}</span>
        )}
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
