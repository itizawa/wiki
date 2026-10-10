import { Calendar, Check, ChevronRight, ChevronsLeft, ChevronsUpDown, Command, History, House, Keyboard, LogOut, Plus, Search, Settings, Star, Workflow } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import { Tooltip } from "./Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, useNavigate, useParams } from "@tanstack/react-router";
import { childrenByParent, type StructureOpInput, type TreeNode } from "@wiki/shared";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage, type StructureResponse, type StructureTree } from "../lib/api";
import { pageLink, screenLink, useWiki, type WikiScreen } from "../lib/wiki";
import { moveStar, useStars } from "../lib/stars";
import { usePersistentState } from "../lib/storage";
import { decodeDropTarget, encodeDropTarget, resolveDrop } from "../lib/tree";
import { openShortcutGuide } from "./ShortcutGuide";
import { StarButton } from "./StarButton";
import { WikiIcon } from "./WikiIcon";
import { Muted, RouterLink } from "./ui";

export const SIDEBAR_WIDTH = 264;
const UNTITLED = "無題";
/** これ以上動かしたらドラッグとみなす距離（px）。 */
const DRAG_DISTANCE = 4;

/** 行の共通の見た目（ナビ項目・ツリーの行・検索結果）。 */
const rowSx = {
  display: "flex",
  alignItems: "center",
  gap: 0.75,
  minHeight: 30,
  px: 1,
  borderRadius: 1,
  color: "text.secondary",
  fontSize: "0.9rem",
  textDecoration: "none",
  cursor: "pointer",
  userSelect: "none",
  "&:hover": { bgcolor: "action.hover" },
  '&[data-status="active"], &[data-active="true"]': { bgcolor: "action.selected", color: "text.primary", fontWeight: 600 },
} as const;

const ellipsis = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** 左サイドバー：検索、画面の切り替え、ドキュメントのツリー。 */
export function Sidebar(props: {
  email: string;
  onCollapse?: () => void;
  onNavigate?: () => void;
  /** コマンドメニュー（⌘K）を開く */
  onOpenCommands: () => void;
  onLogout: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const tree = structure.data?.trees[0];

  const refreshStructure = () => {
    void qc.invalidateQueries({ queryKey: ["structure"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
  };

  const commit = useMutation({
    mutationFn: (ops: StructureOpInput[]) => api.commit({ expectedHeadCommitId: structure.data!.headCommitId, ops }),
    onSettled: (_data, err) => {
      if (!err || (err instanceof ApiError && err.code === "head_moved")) refreshStructure();
    },
  });

  // 親ページの指定があればその下、無ければ最上位の末尾に作る
  const create = useMutation({
    mutationFn: (parentPageId: string | null) => api.createPage({ title: UNTITLED, parentPageId }),
    onSettled: () => {
      refreshStructure();
      void qc.invalidateQueries({ queryKey: ["pages"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
    },
    onSuccess: async (page) => {
      await navigate(pageLink(page.id));
      props.onNavigate?.();
    },
  });

  const error = commit.error ?? create.error ?? structure.error;

  return (
    <Box
      component="nav"
      aria-label="サイドバー"
      sx={{ width: `var(--sidebar-width, ${SIDEBAR_WIDTH}px)`, height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1, pr: 1.5, pt: 1.5, pb: 1 }}>
        <WikiSwitcher onNavigate={props.onNavigate} />
        {props.onCollapse && (
          <Tooltip title="サイドバーを閉じる (⌘.)">
            <IconButton size="small" aria-label="サイドバーを閉じる" onClick={props.onCollapse}>
              <ChevronsLeft size={18} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, pb: 2 }}>
        <NavItem to="/w/$wikiKey/search" icon={<Search size={18} />} onClick={props.onNavigate}>
          検索
        </NavItem>
        <Box component="button" type="button" onClick={props.onOpenCommands} sx={{ ...rowSx, width: "100%", border: 0, bgcolor: "transparent", font: "inherit", fontSize: "0.9rem", textAlign: "left" }}>
          <Command size={18} />
          <Box component="span" sx={ellipsis}>
            コマンドメニュー
          </Box>
          <Box component="kbd" sx={{ px: 0.5, border: 1, borderColor: "divider", borderRadius: 0.5, bgcolor: "background.paper", fontFamily: "inherit", fontSize: "0.7rem" }}>
            ⌘K
          </Box>
        </Box>
        <NavItem to="/w/$wikiKey" exact icon={<House size={18} />} onClick={props.onNavigate}>
          すべてのページ
        </NavItem>
        <NavItem to="/w/$wikiKey/calendar" icon={<Calendar size={18} />} onClick={props.onNavigate}>
          編集カレンダー
        </NavItem>
        <NavItem to="/w/$wikiKey/rules" icon={<Workflow size={18} />} onClick={props.onNavigate}>
          ルール
        </NavItem>
        <NavItem to="/w/$wikiKey/history" icon={<History size={18} />} onClick={props.onNavigate}>
          構造の履歴
        </NavItem>

        {structure.data && <StarredPages pages={structure.data.pages} onNavigate={props.onNavigate} />}

        <Box sx={{ display: "flex", alignItems: "center", mt: 2.5, mb: 0.5, pl: 1 }}>
          <Typography variant="caption" sx={{ flex: 1, color: "text.secondary", fontWeight: 600, letterSpacing: "0.04em" }}>
            ドキュメント
          </Typography>
          <Tooltip title="最上位に新しいページ">
            <span>
              <IconButton size="small" aria-label="最上位に新しいページ" disabled={!tree || create.isPending} onClick={() => create.mutate(null)}>
                <Plus size={18} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {structure.isPending && <Muted sx={{ px: 1 }}>読み込み中…</Muted>}
        {tree && structure.data && (
          <DocumentTree
            tree={tree}
            data={structure.data}
            busy={commit.isPending || create.isPending}
            run={(ops) => {
              commit.reset();
              commit.mutate(ops);
            }}
            onCreatePage={(parentNodeId) => create.mutate(parentNodeId)}
            onNavigate={props.onNavigate}
          />
        )}
      </Box>

      {error && (
        <Alert
          severity="error"
          onClose={() => {
            commit.reset();
            create.reset();
          }}
          sx={{ mx: 1, mb: 1, fontSize: "0.8rem" }}
        >
          {errorMessage(error)}
        </Alert>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}>
        <Muted sx={ellipsis} title={props.email}>
          {props.email}
        </Muted>
        <Tooltip title="キーボードショートカットと記法 (?)">
          <IconButton size="small" aria-label="キーボードショートカットと記法" onClick={openShortcutGuide}>
            <Keyboard size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip title="ログアウト">
          <IconButton size="small" aria-label="ログアウト" onClick={props.onLogout}>
            <LogOut size={18} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

const MenuItemLink = createLink(MenuItem);

/**
 * wiki の切り替え。いまどの wiki にいるかを、サイドバーの上に常に出す（表示名と、公開サイトのサブドメインになる key）。
 * 押すと、選べる wiki の一覧と、wiki の管理（オーナーだけ）への入口を出す。
 */
function WikiSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { wiki, wikis, isOwner } = useWiki();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => {
    setAnchor(null);
    onNavigate?.();
  };
  return (
    <>
      <Tooltip title="wiki を切り替える">
        <Box
          component="button"
          type="button"
          aria-label={`wiki を切り替える（いまは「${wiki.name}」）`}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 0.5,
            border: 0,
            borderRadius: 1,
            bgcolor: "transparent",
            color: "text.primary",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <WikiIcon wiki={wiki} />
          <Box sx={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
            <Box component="strong" sx={{ ...ellipsis, display: "block", fontWeight: 600 }}>
              {wiki.name}
            </Box>
            <Box component="span" sx={{ ...ellipsis, display: "block", color: "text.secondary", fontSize: "0.75rem" }}>
              {wiki.key}
            </Box>
          </Box>
          <Box component={ChevronsUpDown} size={18} sx={{ flexShrink: 0, color: "text.secondary" }} />
        </Box>
      </Tooltip>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true, sx: { minWidth: 240 } } }}>
        <ListSubheader disableSticky sx={{ lineHeight: "28px", fontSize: "0.75rem", fontWeight: 600 }}>
          wiki を切り替える
        </ListSubheader>
        {wikis.map((w) => (
          <MenuItemLink key={w.key} to="/w/$wikiKey" params={{ wikiKey: w.key }} selected={w.key === wiki.key} aria-current={w.key === wiki.key ? "true" : undefined} onClick={close}>
            {/* いまの wiki は、色だけでなくチェックの印でも示す */}
            <ListItemIcon>{w.key === wiki.key && <Check size={18} />}</ListItemIcon>
            <Box sx={{ mr: 1.25, display: "flex" }}>
              <WikiIcon wiki={w} size={24} />
            </Box>
            <ListItemText primary={w.name} secondary={w.key} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
          </MenuItemLink>
        ))}
        {isOwner && <Divider />}
        {isOwner && (
          <MenuItemLink to="/wikis" onClick={close}>
            <ListItemIcon>
              <Settings size={18} />
            </ListItemIcon>
            <ListItemText>wiki の管理（作成・アーカイブ）</ListItemText>
          </MenuItemLink>
        )}
      </Menu>
    </>
  );
}

function NavItem(props: { to: WikiScreen; exact?: boolean; icon: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <RouterLink {...screenLink(props.to)} activeOptions={{ exact: props.exact }} onClick={props.onClick} underline="none" sx={rowSx}>
      {props.icon}
      <Box component="span" sx={ellipsis}>
        {props.children}
      </Box>
    </RouterLink>
  );
}

/** スターを付けたページ。ツリーのどこにあっても、ここからすぐ開ける。ドラッグで並べ替えられる。1つも無ければ何も出さない。 */
function StarredPages({ pages, onNavigate }: { pages: StructureResponse["pages"]; onNavigate?: () => void }) {
  const { ids, reorder } = useStars();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }));
  // 削除されたページのスターは出さない
  const starred = ids.flatMap((id) => (pages[id] ? [pages[id]] : []));
  if (starred.length === 0) return null;
  return (
    <Box component="section" aria-label="スター">
      <Typography variant="caption" sx={{ display: "block", mt: 2.5, mb: 0.5, pl: 1, color: "text.secondary", fontWeight: 600, letterSpacing: "0.04em" }}>
        スター
      </Typography>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          if (e.over && e.active.id !== e.over.id) reorder(moveStar(ids, String(e.active.id), String(e.over.id)));
        }}
      >
        <SortableContext items={starred.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {starred.map((p) => (
            <StarredRow key={p.id} page={p} onNavigate={onNavigate} />
          ))}
        </SortableContext>
      </DndContext>
    </Box>
  );
}

function StarredRow({ page, onNavigate }: { page: StructureResponse["pages"][string]; onNavigate?: () => void }) {
  const sortable = useSortable({ id: page.id });
  // 押した位置。ドラッグして離したときの click で、そのページを開いてしまわないようにするために覚える
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  return (
    <Box
      ref={sortable.setNodeRef}
      {...sortable.listeners}
      onPointerDownCapture={(e) => (pressedAt.current = { x: e.clientX, y: e.clientY })}
      onClickCapture={(e) => {
        const from = pressedAt.current;
        // キーボードで開いたとき（座標が 0）は、いつでも通す
        if (!from || e.detail === 0 || Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_DISTANCE) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined, transition: sortable.transition }}
      sx={[sortable.isDragging && { position: "relative", zIndex: 1, opacity: 0.7 }]}
    >
      <RouterLink {...pageLink(page.id)} draggable={false} onClick={onNavigate} underline="none" sx={rowSx}>
        <Box component={Star} size={18} fill="currentColor" sx={{ color: "warning.main" }} />
        <Box component="span" sx={ellipsis}>
          {page.title}
        </Box>
      </RouterLink>
    </Box>
  );
}

type TreeContext = {
  childrenOf: ReadonlyMap<string | null, TreeNode[]>;
  label: (node: TreeNode) => string;
  activePageId: string | undefined;
  collapsed: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
  expand: (nodeId: string) => void;
  onCreatePage: (parentNodeId: string) => void;
  onNavigate?: () => void;
  /** 折りたたみの動きの長さ。OS の「視差効果を減らす」が有効なら 0 */
  motionMs: number;
};

/** ツリーの折りたたみの動きの長さ（ms）。 */
const TREE_MOTION_MS = 160;

function DocumentTree(props: {
  tree: StructureTree;
  data: StructureResponse;
  busy: boolean;
  run: (ops: StructureOpInput[]) => void;
  onCreatePage: (parentNodeId: string) => void;
  onNavigate?: () => void;
}) {
  const { tree, data, run } = props;
  const { pageId: activePageId } = useParams({ strict: false });
  // 既定は全展開。畳んだものだけを覚えておく（後から増えたページも開いた状態で出る）
  const [collapsedIds, setCollapsedIds] = usePersistentState<string[]>("wiki.sidebar.collapsed", []);
  const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const [dragging, setDragging] = useState<string | null>(null);
  const childrenOf = useMemo(() => childrenByParent(tree.nodes), [tree.nodes]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const label = (n: TreeNode) => data.pages[n.pageId]?.title ?? n.pageId;
  const expand = (nodeId: string) => {
    if (collapsed.has(nodeId)) setCollapsedIds(collapsedIds.filter((id) => id !== nodeId));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const target = e.over ? decodeDropTarget(String(e.over.id)) : null;
    if (!target) return;
    const nodeId = String(e.active.id);
    const move = resolveDrop(tree.nodes, nodeId, target);
    if (!move) return;
    if (move.newParentNodeId) expand(move.newParentNodeId);
    run([{ type: "move", treeId: tree.id, nodeId, ...move }]);
  };

  const ctx: TreeContext = {
    childrenOf,
    label,
    activePageId,
    collapsed,
    toggle: (nodeId) =>
      setCollapsedIds(collapsed.has(nodeId) ? collapsedIds.filter((id) => id !== nodeId) : [...collapsedIds, nodeId]),
    expand,
    onCreatePage: (parentNodeId) => {
      expand(parentNodeId);
      props.onCreatePage(parentNodeId);
    },
    onNavigate: props.onNavigate,
    motionMs: reducedMotion ? 0 : TREE_MOTION_MS,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <Box role="tree" aria-label="ドキュメント" sx={[props.busy && { opacity: 0.6, pointerEvents: "none" }]}>
        {(childrenOf.get(null) ?? []).map((node) => (
          <TreeRow key={node.nodeId} node={node} depth={0} ctx={ctx} />
        ))}
        {tree.nodes.length === 0 && <Muted sx={{ px: 1 }}>ページはまだありません。</Muted>}
      </Box>
      <RootEndZone active={dragging !== null} />
      <DragOverlay>
        {dragging && (
          <Paper variant="outlined" sx={{ px: 1, py: 0.5, fontSize: "0.9rem", borderColor: "primary.main", boxShadow: 3 }}>
            {label(tree.nodes.find((n) => n.nodeId === dragging)!)}
          </Paper>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** ドロップ判定用の領域。行の上35%で「前へ」、残りで「このページの下へ」 */
const dropZone = { position: "absolute", left: 0, right: 0, pointerEvents: "none" } as const;

function TreeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeContext }) {
  const kids = ctx.childrenOf.get(node.nodeId) ?? [];
  const isOpen = !ctx.collapsed.has(node.nodeId);
  const isActive = node.pageId === ctx.activePageId;
  const drag = useDraggable({ id: node.nodeId });
  const before = useDroppable({ id: encodeDropTarget({ kind: "before", nodeId: node.nodeId }) });
  const into = useDroppable({ id: encodeDropTarget({ kind: "into", nodeId: node.nodeId }) });
  const title = ctx.label(node);

  // 行のアイコンは出さない（どのページも同じで見分ける手がかりにならず、タイトルの幅を狭めるため）
  const labelSx = { ...ellipsis, display: "flex", alignItems: "center", pl: 0.25, color: "inherit", textDecoration: "none" };

  return (
    <Box role="treeitem" aria-expanded={kids.length > 0 ? isOpen : undefined} aria-selected={isActive}>
      <Box
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        role={undefined}
        tabIndex={undefined}
        data-active={isActive}
        sx={{
          ...rowSx,
          position: "relative",
          gap: 0.25,
          pl: `${4 + depth * 16}px`,
          pr: 0.5,
          opacity: drag.isDragging ? 0.4 : 1,
          boxShadow: (t) => (before.isOver ? `inset 0 2px 0 ${(t.vars ?? t).palette.primary.main}` : "none"),
          ...(into.isOver && { bgcolor: (t) => `color-mix(in srgb, ${(t.vars ?? t).palette.primary.main} 15%, transparent)` }),
          // 行の操作は、いつも出しておく（マウスを乗せたときだけ出すと、タッチ端末では押せない）。ふだんは薄く、行に乗せたら濃くする
          "& .row-actions": { display: "flex", opacity: 0.55 },
          "&:hover .row-actions, &:focus-within .row-actions": { opacity: 1 },
        }}
      >
        <Box ref={before.setNodeRef} sx={{ ...dropZone, top: 0, height: "35%" }} />
        <Box ref={into.setNodeRef} sx={{ ...dropZone, top: "35%", bottom: 0 }} />
        <IconButton
          size="small"
          aria-label={isOpen ? "たたむ" : "ひらく"}
          onClick={() => ctx.toggle(node.nodeId)}
          sx={{ p: 0, width: 20, height: 20, flexShrink: 0, visibility: kids.length > 0 ? "visible" : "hidden" }}
        >
          <Box component={ChevronRight} size={18} sx={{ transition: "transform 120ms", transform: isOpen ? "rotate(90deg)" : "none" }} />
        </IconButton>
        <RouterLink {...pageLink(node.pageId)} draggable={false} onClick={ctx.onNavigate} underline="none" sx={labelSx}>
          <Box component="span" sx={ellipsis}>
            {title}
          </Box>
        </RouterLink>
        <Box className="row-actions" sx={{ flexShrink: 0 }}>
          <StarButton pageId={node.pageId} title={title} iconSize={18} sx={{ p: 0.25 }} />
          <Tooltip title="この下に新しいページ">
            <IconButton size="small" aria-label={`「${title}」の下に新しいページ`} onClick={() => ctx.onCreatePage(node.nodeId)} sx={{ p: 0.25 }}>
              <Plus size={18} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      {kids.length > 0 && (
        // 子ページの行は、高さを動かして出し入れする。畳んでいる間は描画しない
        <Collapse in={isOpen} timeout={ctx.motionMs} unmountOnExit role="group">
          {kids.map((kid) => (
            <TreeRow key={kid.nodeId} node={kid} depth={depth + 1} ctx={ctx} />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

/** ツリーの下の余白。ドラッグ中だけ「最上位の末尾へ」の落とし先として見せる。 */
function RootEndZone({ active }: { active: boolean }) {
  const drop = useDroppable({ id: encodeDropTarget({ kind: "root-end" }) });
  return (
    <Box
      ref={drop.setNodeRef}
      sx={{
        mt: 0.5,
        py: 0.75,
        borderRadius: 1,
        border: "1px dashed",
        borderColor: drop.isOver ? "primary.main" : active ? "divider" : "transparent",
        color: drop.isOver ? "primary.main" : "text.secondary",
        fontSize: "0.75rem",
        textAlign: "center",
      }}
    >
      <Box component="span" sx={{ visibility: active ? "visible" : "hidden" }}>
        最上位の末尾へ
      </Box>
    </Box>
  );
}
