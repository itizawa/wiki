import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { childrenMarkdown, type ChildrenItem, type ChildrenSort } from "@wiki/shared";
import { api } from "../lib/api";
import { childrenItemsOf } from "../lib/childrenItems";

function Items({ items }: { items: ChildrenItem[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: "1.4em" }}>
      {items.map((item) => (
        <li key={item.path}>
          {item.title || "無題"}
          {item.children.length > 0 && <Items items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * 編集中の `@children`。公開サイトと同じ決まりで、このページの配下の公開ページを箇条書きで見せる。
 * ページを開いていない画面（テンプレートなど）では、並べる相手がいないので、書き方だけを見せる。
 */
export function ChildrenListView({ node, selected }: ReactNodeViewProps) {
  const depth = Number(node.attrs.depth);
  const sort = node.attrs.sort as ChildrenSort;
  const { pageId } = useParams({ strict: false }) as { pageId?: string };
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure, enabled: pageId != null });
  const items = pageId ? childrenItemsOf(structure.data, pageId, { depth, sort }) : [];

  let body;
  if (!pageId) body = <code>{childrenMarkdown({ depth, sort })}</code>;
  else if (structure.isPending) body = <span style={{ opacity: 0.7 }}>読み込み中…</span>;
  else if (structure.error) body = <span style={{ opacity: 0.7 }}>配下のページを読み込めませんでした。</span>;
  else if (items.length === 0) body = <span style={{ opacity: 0.7 }}>配下に公開ページはまだありません。公開サイトでは何も出ません。</span>;
  else body = <Items items={items} />;

  return (
    <NodeViewWrapper
      data-children-list=""
      role="group"
      aria-label="配下のページの一覧"
      style={{ margin: "12px 0", borderRadius: 4, outline: selected ? "2px solid rgba(128,128,128,0.6)" : undefined, outlineOffset: 4 }}
    >
      {body}
    </NodeViewWrapper>
  );
}
