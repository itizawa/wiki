import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { INBOX_NODE_ID, TREE_KEY_PATTERN, type StructureOpInput, type TreeNode } from "@wiki/shared";
import { useMemo, useState } from "react";
import { api, ApiError, errorMessage, type StructureResponse, type StructureTree } from "../lib/api";
import { decodeDropTarget, encodeDropTarget, flatten, resolveDrop, type Row } from "../lib/tree";

export function TreePage() {
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);

  const commit = useMutation({
    mutationFn: (input: { ops: StructureOpInput[]; message?: string }) =>
      api.commit({ expectedHeadCommitId: structure.data!.headCommitId, ...input }),
    onSettled: (_data, err) => {
      if (!err || (err instanceof ApiError && err.code === "head_moved")) {
        void qc.invalidateQueries({ queryKey: ["structure"] });
        void qc.invalidateQueries({ queryKey: ["history"] });
      }
    },
  });

  if (structure.isPending) return <p className="muted">読み込み中…</p>;
  if (structure.error) return <p className="error">{errorMessage(structure.error)}</p>;
  const data = structure.data;
  const tree = data.trees.find((t) => t.id === activeTreeId) ?? data.trees[0]!;

  const run = (ops: StructureOpInput[], message?: string) => {
    commit.reset();
    commit.mutate({ ops, message });
  };

  return (
    <div className="stack">
      <div className="row">
        <div className="tabs grow">
          {data.trees.map((t) => (
            <button key={t.id} className={t.id === tree.id ? "active" : ""} onClick={() => setActiveTreeId(t.id)}>
              {t.name}
              {t.isPrimary && " ★"}
            </button>
          ))}
          <button
            onClick={() => {
              const key = prompt("ツリーのキー（URLに使う英小文字・数字・ハイフン。例: by-theme）");
              if (!key) return;
              if (!TREE_KEY_PATTERN.test(key)) return alert("キーは英小文字・数字・ハイフンで入力してください");
              const name = prompt("表示名", key);
              if (name) run([{ type: "create_tree", treeKey: key, name }], `ツリー「${name}」を追加`);
            }}
          >
            ＋ ツリー
          </button>
        </div>
        <span className="badge" title="ブランチの作成・マージはフェーズ3で対応">
          ブランチ: {data.branch}
        </span>
      </div>

      {commit.error && <p className="error">{errorMessage(commit.error)}</p>}

      <TreeHeader tree={tree} onDelete={() => run([{ type: "delete_tree", treeId: tree.id }], `ツリー「${tree.name}」を削除`)} />
      <TreeEditor key={tree.id} tree={tree} data={data} busy={commit.isPending} run={run} />
    </div>
  );
}

function TreeHeader({ tree, onDelete }: { tree: StructureTree; onDelete: () => void }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateTree>[1]) => api.updateTree(tree.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["structure"] }),
  });
  return (
    <div className="card row small">
      <span className="mono muted">/t/{tree.key}/</span>
      <label className="row">
        <input
          type="checkbox"
          checked={tree.isPublic}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ isPublic: e.target.checked })}
        />
        公開ツリー
      </label>
      <button
        className="link"
        onClick={() => {
          const name = prompt("表示名", tree.name);
          if (name && name !== tree.name) update.mutate({ name });
        }}
      >
        名前を変更
      </button>
      {tree.isPrimary ? (
        <span className="muted">primary（パンくず・既定ナビ）</span>
      ) : (
        <>
          <button className="link" onClick={() => update.mutate({ isPrimary: true })}>
            primaryにする
          </button>
          <button className="link danger" onClick={() => confirm(`ツリー「${tree.name}」を削除しますか？`) && onDelete()}>
            ツリーを削除
          </button>
        </>
      )}
      {update.error && <span className="error">{errorMessage(update.error)}</span>}
    </div>
  );
}

function TreeEditor(props: {
  tree: StructureTree;
  data: StructureResponse;
  busy: boolean;
  run: (ops: StructureOpInput[], message?: string) => void;
}) {
  const { tree, data, run } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useMemo(() => flatten(tree.nodes, collapsed), [tree.nodes, collapsed]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const allPages = useQuery({ queryKey: ["pages", ""], queryFn: () => api.listPages() });
  const unplaced = (allPages.data?.pages ?? []).filter((p) => !tree.nodes.some((n) => n.pageId === p.id));

  const label = (n: TreeNode) => (n.kind === "folder" ? n.title! : data.pages[n.pageId!]?.title ?? n.pageId!);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const target = e.over ? decodeDropTarget(String(e.over.id)) : null;
    if (!target) return;
    const nodeId = String(e.active.id);
    const move = resolveDrop(tree.nodes, nodeId, target);
    if (move) run([{ type: "move", treeId: tree.id, nodeId, ...move }]);
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="tree-layout">
      <section className="card">
        <div className="row">
          <button
            className="button"
            disabled={props.busy}
            onClick={() => {
              const title = prompt("フォルダ名");
              if (title) run([{ type: "create_folder", treeId: tree.id, title, parentNodeId: null }]);
            }}
          >
            ＋ フォルダ
          </button>
          <span className="muted small">ドラッグで移動。行の上端に落とすと「前へ」、行に重ねると「中へ」。</span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(e) => setDragging(String(e.active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <ul className={`tree ${props.busy ? "busy" : ""}`}>
            {rows.map((row) => (
              <TreeRow
                key={row.node.nodeId}
                row={row}
                label={label(row.node)}
                collapsed={collapsed.has(row.node.nodeId)}
                onToggle={() => toggle(row.node.nodeId)}
                onRename={() => {
                  const title = prompt("フォルダ名", row.node.title ?? "");
                  if (title && title !== row.node.title)
                    run([{ type: "rename_folder", treeId: tree.id, nodeId: row.node.nodeId, title }]);
                }}
                onAddFolder={() => {
                  const title = prompt("フォルダ名");
                  if (title) run([{ type: "create_folder", treeId: tree.id, title, parentNodeId: row.node.nodeId }]);
                }}
                onRemove={() => run([{ type: "remove_node", treeId: tree.id, nodeId: row.node.nodeId }])}
              />
            ))}
            <RootEndZone />
          </ul>
          <DragOverlay>
            {dragging && <div className="tree-row overlay">{label(tree.nodes.find((n) => n.nodeId === dragging)!)}</div>}
          </DragOverlay>
        </DndContext>
      </section>

      <section className="card">
        <h3>このツリーに無いページ</h3>
        <p className="muted small">1つのページを複数のツリーの別々の位置に置けます。</p>
        {unplaced.length === 0 && <p className="muted small">すべてのページがこのツリーにあります。</p>}
        <ul className="plain">
          {unplaced.map((p) => (
            <li key={p.id} className="row">
              <span className="grow">{p.title}</span>
              <button
                className="link"
                disabled={props.busy}
                onClick={() =>
                  run([
                    {
                      type: "add_to_tree",
                      treeId: tree.id,
                      pageId: p.id,
                      parentNodeId: tree.nodes.some((n) => n.nodeId === INBOX_NODE_ID) ? INBOX_NODE_ID : null,
                    },
                  ])
                }
              >
                追加
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TreeRow(props: {
  row: Row;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onRename: () => void;
  onAddFolder: () => void;
  onRemove: () => void;
}) {
  const { node, depth, childCount } = props.row;
  const isInbox = node.nodeId === INBOX_NODE_ID;
  const drag = useDraggable({ id: node.nodeId, disabled: isInbox });
  const before = useDroppable({ id: encodeDropTarget({ kind: "before", nodeId: node.nodeId }), disabled: isInbox });
  const into = useDroppable({ id: encodeDropTarget({ kind: "into", nodeId: node.nodeId }) });

  return (
    <li
      className={`tree-row ${drag.isDragging ? "dragging" : ""} ${into.isOver ? "over-into" : ""} ${before.isOver ? "over-before" : ""}`}
      style={{ paddingLeft: 8 + depth * 20 }}
    >
      <div ref={before.setNodeRef} className="drop-before" />
      <div ref={into.setNodeRef} className="drop-into" />
      <button className="twisty" onClick={props.onToggle} disabled={childCount === 0}>
        {childCount === 0 ? "·" : props.collapsed ? "▸" : "▾"}
      </button>
      <span ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className={`node-label ${node.kind}`}>
        {node.kind === "folder" ? "📁 " : "📄 "}
        {node.kind === "page" ? (
          <Link to="/pages/$pageId" params={{ pageId: node.pageId! }}>
            {props.label}
          </Link>
        ) : (
          props.label
        )}
        {childCount > 0 && <span className="muted small"> ({childCount})</span>}
      </span>
      <span className="row-actions">
        {node.kind === "folder" && !isInbox && (
          <button className="link" onClick={props.onRename}>
            名前変更
          </button>
        )}
        {!isInbox && (
          <button className="link" onClick={props.onAddFolder}>
            ＋子フォルダ
          </button>
        )}
        {!isInbox && (
          <button
            className="link danger"
            disabled={childCount > 0}
            title={childCount > 0 ? "子を移動してから外せます" : node.kind === "page" ? "このツリーから外す（ページは残る）" : "フォルダを削除"}
            onClick={props.onRemove}
          >
            {node.kind === "page" ? "外す" : "削除"}
          </button>
        )}
      </span>
    </li>
  );
}

function RootEndZone() {
  const drop = useDroppable({ id: encodeDropTarget({ kind: "root-end" }) });
  return (
    <li ref={drop.setNodeRef} className={`tree-end ${drop.isOver ? "over-into" : ""}`}>
      最上位の末尾へ
    </li>
  );
}
