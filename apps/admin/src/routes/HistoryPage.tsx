import { useQuery } from "@tanstack/react-query";
import type { StructureChange } from "@wiki/shared";
import { useState } from "react";
import { api, errorMessage, type StructureResponse } from "../lib/api";
import { formatDateTime } from "../lib/format";

export function HistoryPage() {
  const history = useQuery({ queryKey: ["history"], queryFn: api.history });
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const [selected, setSelected] = useState<string | null>(null);

  if (history.isPending) return <p className="muted">読み込み中…</p>;
  if (history.error) return <p className="error">{errorMessage(history.error)}</p>;

  return (
    <div className="tree-layout">
      <section className="card">
        <h2>構造の履歴（main）</h2>
        <p className="muted small">ツリーへの変更はすべてコミットとして記録されます。巻き戻しはフェーズ3で追加します。</p>
        <ul className="plain commits">
          {history.data.commits.map((c, i) => (
            <li key={c.id}>
              <button className={`link ${selected === c.id ? "active" : ""}`} onClick={() => setSelected(c.id)}>
                {c.message ?? "(no message)"}
              </button>
              {i === 0 && <span className="badge">head</span>}
              {c.authorType === "ai" && <span className="badge">AI</span>}
              {c.parentIds.length > 1 && <span className="badge">merge</span>}
              <div className="muted small">
                {formatDateTime(c.createdAt)} · <span className="mono">{c.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">{selected ? <CommitDetail id={selected} structure={structure.data} /> : <p className="muted">コミットを選ぶと差分を表示します。</p>}</section>
    </div>
  );
}

function CommitDetail({ id, structure }: { id: string; structure?: StructureResponse }) {
  const detail = useQuery({ queryKey: ["commit", id], queryFn: () => api.commitDetail(id) });
  if (detail.isPending) return <p className="muted">読み込み中…</p>;
  if (detail.error) return <p className="error">{errorMessage(detail.error)}</p>;

  const treeName = (treeId: string) => structure?.trees.find((t) => t.id === treeId)?.name ?? treeId;
  const nodeName = (treeId: string, nodeId: string | null) => {
    if (nodeId === null) return "最上位";
    const node = structure?.trees.find((t) => t.id === treeId)?.nodes.find((n) => n.nodeId === nodeId);
    if (node?.kind === "folder") return node.title!;
    return structure?.pages[nodeId]?.title ?? nodeId;
  };
  const describe = (c: StructureChange): string => {
    switch (c.kind) {
      case "tree_added":
        return "ツリーを追加";
      case "tree_removed":
        return "ツリーを削除";
      case "node_added":
        return `追加: ${c.node.title ?? nodeName(c.treeId, c.node.nodeId)} → ${nodeName(c.treeId, c.node.parentNodeId)}`;
      case "node_removed":
        return `削除: ${c.node.title ?? nodeName(c.treeId, c.node.nodeId)}`;
      case "node_moved":
        return `移動: ${nodeName(c.treeId, c.nodeId)}（${nodeName(c.treeId, c.from)} → ${nodeName(c.treeId, c.to)}）`;
      case "node_reordered":
        return `並び替え: ${nodeName(c.treeId, c.nodeId)}`;
      case "node_renamed":
        return `改名: ${c.from} → ${c.to}`;
    }
  };

  const byTree = new Map<string, StructureChange[]>();
  for (const c of detail.data.changes) byTree.set(c.treeId, [...(byTree.get(c.treeId) ?? []), c]);

  return (
    <div className="stack">
      <h3>{detail.data.commit.message}</h3>
      {byTree.size === 0 && <p className="muted">構造の変更はありません。</p>}
      {[...byTree].map(([treeId, changes]) => (
        <div key={treeId}>
          <h4>{treeName(treeId)}</h4>
          <ul className="changes">
            {changes.map((c, i) => (
              <li key={i} className={c.kind}>
                {describe(c)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
