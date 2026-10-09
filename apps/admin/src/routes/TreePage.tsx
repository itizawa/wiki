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
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { SimpleTreeView } from "@mui/x-tree-view/SimpleTreeView";
import { TreeItem, treeItemClasses } from "@mui/x-tree-view/TreeItem";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { childrenByParent, INBOX_NODE_ID, type StructureOpInput, type TreeNode } from "@wiki/shared";
import { useMemo, useState } from "react";
import { Mono, Muted, RouterLink, Row, Section, WithSidebar } from "../components/ui";
import { api, ApiError, errorMessage, type StructureResponse, type StructureTree } from "../lib/api";
import { decodeDropTarget, encodeDropTarget, resolveDrop } from "../lib/tree";

export function TreePage() {
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });

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

  if (structure.isPending) return <Muted>読み込み中…</Muted>;
  if (structure.error) return <Alert severity="error">{errorMessage(structure.error)}</Alert>;
  const data = structure.data;
  const tree = data.trees[0]!;

  const run = (ops: StructureOpInput[], message?: string) => {
    commit.reset();
    commit.mutate({ ops, message });
  };

  return (
    <Stack spacing={1.5}>
      {commit.error && <Alert severity="error">{errorMessage(commit.error)}</Alert>}

      <TreeHeader tree={tree} />
      <TreeEditor tree={tree} data={data} busy={commit.isPending} run={run} />
    </Stack>
  );
}

function TreeHeader({ tree }: { tree: StructureTree }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateTree>[1]) => api.updateTree(tree.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["structure"] }),
  });
  return (
    <Section sx={{ py: 1 }}>
      <Row sx={{ typography: "body2" }}>
        <Mono sx={{ color: "text.secondary" }}>/t/{tree.key}/</Mono>
        <FormControlLabel
          label="公開サイトに表示"
          slotProps={{ typography: { variant: "body2" } }}
          sx={{ mx: 0 }}
          control={
            <Checkbox
              size="small"
              checked={tree.isPublic}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ isPublic: e.target.checked })}
            />
          }
        />
        <Button
          variant="text"
          onClick={() => {
            const name = prompt("表示名", tree.name);
            if (name && name !== tree.name) update.mutate({ name });
          }}
        >
          名前を変更
        </Button>
        {update.error && (
          <Typography variant="body2" color="error">
            {errorMessage(update.error)}
          </Typography>
        )}
      </Row>
    </Section>
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
  const children = useMemo(() => childrenByParent(tree.nodes), [tree.nodes]);
  // 既定は全展開。畳んだものだけを覚えておく（後から増えたフォルダも開いた状態で出る）
  const expanded = useMemo(
    () => tree.nodes.filter((n) => children.has(n.nodeId) && !collapsed.has(n.nodeId)).map((n) => n.nodeId),
    [tree.nodes, children, collapsed],
  );
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

  const handlers: NodeHandlers = {
    label,
    isCollapsed: (node) => collapsed.has(node.nodeId),
    onRename: (node) => {
      const title = prompt("フォルダ名", node.title ?? "");
      if (title && title !== node.title) run([{ type: "rename_folder", treeId: tree.id, nodeId: node.nodeId, title }]);
    },
    onAddFolder: (node) => {
      const title = prompt("フォルダ名");
      if (title) run([{ type: "create_folder", treeId: tree.id, title, parentNodeId: node.nodeId }]);
    },
    onRemove: (node) => run([{ type: "remove_node", treeId: tree.id, nodeId: node.nodeId }]),
  };

  return (
    <WithSidebar>
      <Section>
        <Row>
          <Button
            variant="outlined"
            disabled={props.busy}
            onClick={() => {
              const title = prompt("フォルダ名");
              if (title) run([{ type: "create_folder", treeId: tree.id, title, parentNodeId: null }]);
            }}
          >
            ＋ フォルダ
          </Button>
          <Muted component="span">ドラッグで移動。行の上端に落とすと「前へ」、行に重ねると「中へ」。</Muted>
        </Row>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(e) => setDragging(String(e.active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <SimpleTreeView
            disableSelection
            expansionTrigger="iconContainer"
            itemChildrenIndentation={20}
            expandedItems={expanded}
            onItemExpansionToggle={(_e, itemId, isExpanded) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (isExpanded) next.delete(itemId);
                else next.add(itemId);
                return next;
              })
            }
            sx={[{ mt: 1.5 }, props.busy && { opacity: 0.6, pointerEvents: "none" }]}
          >
            {(children.get(null) ?? []).map((node) => (
              <TreeNodeItem key={node.nodeId} node={node} childrenOf={children} handlers={handlers} />
            ))}
          </SimpleTreeView>
          <RootEndZone />
          <DragOverlay>
            {dragging && (
              <Paper variant="outlined" sx={{ px: 1, py: 0.5, borderColor: "primary.main", boxShadow: 3 }}>
                {label(tree.nodes.find((n) => n.nodeId === dragging)!)}
              </Paper>
            )}
          </DragOverlay>
        </DndContext>
      </Section>

      <Section>
        <Typography variant="subtitle1" component="h3">
          ツリーに無いページ
        </Typography>
        {unplaced.length === 0 && <Muted>すべてのページがツリーにあります。</Muted>}
        <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0, mt: 1 }}>
          {unplaced.map((p) => (
            <Row component="li" key={p.id}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{p.title}</Box>
              <Button
                variant="text"
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
              </Button>
            </Row>
          ))}
        </Stack>
      </Section>
    </WithSidebar>
  );
}

type NodeHandlers = {
  label: (node: TreeNode) => string;
  isCollapsed: (node: TreeNode) => boolean;
  onRename: (node: TreeNode) => void;
  onAddFolder: (node: TreeNode) => void;
  onRemove: (node: TreeNode) => void;
};

/** ドロップ判定用の領域。行の上35%で「前へ」、残りで「中へ」 */
const dropZone = { position: "absolute", left: 0, right: 0, pointerEvents: "none" } as const;

function TreeNodeItem(props: {
  node: TreeNode;
  childrenOf: ReadonlyMap<string | null, TreeNode[]>;
  handlers: NodeHandlers;
  /** 畳まれた祖先の下にある。DOMには残るので、ドロップ先から外す */
  hidden?: boolean;
}) {
  const { node, childrenOf, handlers, hidden = false } = props;
  const kids = childrenOf.get(node.nodeId) ?? [];
  const childCount = kids.length;
  const isInbox = node.nodeId === INBOX_NODE_ID;
  const drag = useDraggable({ id: node.nodeId, disabled: isInbox });
  const before = useDroppable({ id: encodeDropTarget({ kind: "before", nodeId: node.nodeId }), disabled: isInbox || hidden });
  const into = useDroppable({ id: encodeDropTarget({ kind: "into", nodeId: node.nodeId }), disabled: hidden });

  return (
    <TreeItem
      itemId={node.nodeId}
      sx={{
        [`& > .${treeItemClasses.content}`]: {
          cursor: "default",
          borderTop: "2px solid",
          borderTopColor: before.isOver ? "primary.main" : "transparent",
          opacity: drag.isDragging ? 0.4 : 1,
          ...(into.isOver && { bgcolor: (t) => `color-mix(in srgb, ${(t.vars ?? t).palette.primary.main} 15%, transparent)` }),
          "&:hover .tree-actions, &:focus-within .tree-actions": { opacity: 1 },
        },
        // ドロップ領域を行全体（インデントやアイコンの部分も含む）に広げるため、基準を content にする
        [`& > .${treeItemClasses.content} > .${treeItemClasses.label}`]: { position: "static", overflow: "visible" },
      }}
      label={
        // 行内のボタンのキー操作を、ツリーのキーボード操作（Enterで開閉など）に取られないようにする
        <Row spacing={0.75} onKeyDown={(e) => e.stopPropagation()} sx={{ flexWrap: "nowrap" }}>
          <Box ref={before.setNodeRef} sx={{ ...dropZone, top: 0, height: "35%" }} />
          <Box ref={into.setNodeRef} sx={{ ...dropZone, top: "35%", bottom: 0 }} />
          <Box
            component="span"
            ref={drag.setNodeRef}
            {...drag.listeners}
            {...drag.attributes}
            sx={{ cursor: isInbox ? "default" : "grab", userSelect: "none", fontWeight: node.kind === "folder" ? 500 : undefined }}
          >
            {node.kind === "folder" ? "📁 " : "📄 "}
            {node.kind === "page" ? (
              <RouterLink to="/pages/$pageId" params={{ pageId: node.pageId! }}>
                {handlers.label(node)}
              </RouterLink>
            ) : (
              handlers.label(node)
            )}
            {childCount > 0 && (
              <Muted component="span"> ({childCount})</Muted>
            )}
          </Box>
          {!isInbox && (
            <Row className="tree-actions" spacing={0} sx={{ ml: "auto", flexWrap: "nowrap", opacity: 0 }}>
              {node.kind === "folder" && (
                <Button variant="text" onClick={() => handlers.onRename(node)}>
                  名前変更
                </Button>
              )}
              <Button variant="text" onClick={() => handlers.onAddFolder(node)}>
                ＋子フォルダ
              </Button>
              <Tooltip title={childCount > 0 ? "子を移動してから外せます" : node.kind === "page" ? "ツリーから外す（ページは残る）" : "フォルダを削除"}>
                <span>
                  <Button variant="text" color="error" disabled={childCount > 0} onClick={() => handlers.onRemove(node)}>
                    {node.kind === "page" ? "外す" : "削除"}
                  </Button>
                </span>
              </Tooltip>
            </Row>
          )}
        </Row>
      }
    >
      {kids.map((kid) => (
        <TreeNodeItem key={kid.nodeId} node={kid} childrenOf={childrenOf} handlers={handlers} hidden={hidden || handlers.isCollapsed(node)} />
      ))}
    </TreeItem>
  );
}

function RootEndZone() {
  const drop = useDroppable({ id: encodeDropTarget({ kind: "root-end" }) });
  return (
    <Box
      ref={drop.setNodeRef}
      sx={{
        p: 1,
        mt: 0.5,
        border: "1px dashed",
        borderColor: drop.isOver ? "primary.main" : "divider",
        borderRadius: 1,
        color: drop.isOver ? "primary.main" : "text.secondary",
        fontSize: "0.8rem",
        textAlign: "center",
      }}
    >
      最上位の末尾へ
    </Box>
  );
}
