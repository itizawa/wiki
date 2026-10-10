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
import AddIcon from "@mui/icons-material/Add";
import AutoModeIcon from "@mui/icons-material/AutoMode";
import CheckIcon from "@mui/icons-material/Check";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HistoryIcon from "@mui/icons-material/History";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import KeyboardCommandKeyIcon from "@mui/icons-material/KeyboardCommandKey";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import LinkIcon from "@mui/icons-material/Link";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import InputBase from "@mui/material/InputBase";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import { Tooltip } from "./Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, useNavigate, useParams } from "@tanstack/react-router";
import { childrenByParent, type StructureOpInput, type TreeNode, type Visibility } from "@wiki/shared";
import { useMemo, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage, type StructureResponse, type StructureTree } from "../lib/api";
import { pageLink, screenLink, useWiki, type WikiScreen } from "../lib/wiki";
import { useStars } from "../lib/stars";
import { usePersistentState } from "../lib/storage";
import { decodeDropTarget, encodeDropTarget, resolveDrop } from "../lib/tree";
import { openShortcutGuide } from "./ShortcutGuide";
import { WikiIcon } from "./WikiIcon";
import { Muted, RouterLink } from "./ui";

export const SIDEBAR_WIDTH = 264;
const UNTITLED = "無題";

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
  const [q, setQ] = useState("");
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
              <KeyboardDoubleArrowLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ px: 1.5, pb: 1 }}>
        <InputBase
          fullWidth
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索…"
          inputProps={{ "aria-label": "ページを検索" }}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          }
          sx={{ px: 1, height: 32, fontSize: "0.9rem", borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "background.paper" }}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, pb: 2 }}>
        {q.trim() ? (
          <SearchResults q={q.trim()} onNavigate={props.onNavigate} />
        ) : (
          <>
            <Box component="button" type="button" onClick={props.onOpenCommands} sx={{ ...rowSx, width: "100%", border: 0, bgcolor: "transparent", font: "inherit", fontSize: "0.9rem", textAlign: "left" }}>
              <KeyboardCommandKeyIcon fontSize="small" />
              <Box component="span" sx={ellipsis}>
                コマンドメニュー
              </Box>
              <Box component="kbd" sx={{ px: 0.5, border: 1, borderColor: "divider", borderRadius: 0.5, bgcolor: "background.paper", fontFamily: "inherit", fontSize: "0.7rem" }}>
                ⌘K
              </Box>
            </Box>
            <NavItem to="/w/$wikiKey" exact icon={<HomeOutlinedIcon fontSize="small" />} onClick={props.onNavigate}>
              すべてのページ
            </NavItem>
            <NavItem to="/w/$wikiKey/calendar" icon={<CalendarMonthOutlinedIcon fontSize="small" />} onClick={props.onNavigate}>
              編集カレンダー
            </NavItem>
            <NavItem to="/w/$wikiKey/rules" icon={<AutoModeIcon fontSize="small" />} onClick={props.onNavigate}>
              ルール
            </NavItem>
            <NavItem to="/w/$wikiKey/history" icon={<HistoryIcon fontSize="small" />} onClick={props.onNavigate}>
              構造の履歴
            </NavItem>

            {structure.data && <StarredPages pages={structure.data.pages} onNavigate={props.onNavigate} />}

            <Box sx={{ display: "flex", alignItems: "center", mt: 2.5, mb: 0.5, pl: 1 }}>
              <Typography variant="caption" sx={{ flex: 1, color: "text.secondary", fontWeight: 600, letterSpacing: "0.04em" }}>
                ドキュメント
              </Typography>
              {tree && <TreeSettings tree={tree} />}
              <Tooltip title="最上位に新しいページ">
                <span>
                  <IconButton size="small" aria-label="最上位に新しいページ" disabled={!tree || create.isPending} onClick={() => create.mutate(null)}>
                    <AddIcon sx={{ fontSize: 18 }} />
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
          </>
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
            <KeyboardOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="ログアウト">
          <IconButton size="small" aria-label="ログアウト" onClick={props.onLogout}>
            <LogoutIcon fontSize="small" />
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
          <UnfoldMoreIcon sx={{ fontSize: 18, flexShrink: 0, color: "text.secondary" }} />
        </Box>
      </Tooltip>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true, sx: { minWidth: 240 } } }}>
        <ListSubheader disableSticky sx={{ lineHeight: "28px", fontSize: "0.75rem", fontWeight: 600 }}>
          wiki を切り替える
        </ListSubheader>
        {wikis.map((w) => (
          <MenuItemLink key={w.key} to="/w/$wikiKey" params={{ wikiKey: w.key }} selected={w.key === wiki.key} aria-current={w.key === wiki.key ? "true" : undefined} onClick={close}>
            {/* いまの wiki は、色だけでなくチェックの印でも示す */}
            <ListItemIcon>{w.key === wiki.key && <CheckIcon fontSize="small" />}</ListItemIcon>
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
              <SettingsOutlinedIcon fontSize="small" />
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

/** スターを付けたページ。ツリーのどこにあっても、ここからすぐ開ける。1つも無ければ何も出さない。 */
function StarredPages({ pages, onNavigate }: { pages: StructureResponse["pages"]; onNavigate?: () => void }) {
  const { ids } = useStars();
  // 削除されたページのスターは出さない
  const starred = ids.flatMap((id) => (pages[id] ? [pages[id]] : []));
  if (starred.length === 0) return null;
  return (
    <Box component="section" aria-label="スター">
      <Typography variant="caption" sx={{ display: "block", mt: 2.5, mb: 0.5, pl: 1, color: "text.secondary", fontWeight: 600, letterSpacing: "0.04em" }}>
        スター
      </Typography>
      {starred.map((p) => (
        <RouterLink key={p.id} {...pageLink(p.id)} onClick={onNavigate} underline="none" sx={rowSx}>
          <StarIcon sx={{ fontSize: 18, color: "warning.main" }} />
          <Box component="span" sx={ellipsis}>
            {p.title}
          </Box>
        </RouterLink>
      ))}
    </Box>
  );
}

function SearchResults({ q, onNavigate }: { q: string; onNavigate?: () => void }) {
  const pages = useQuery({ queryKey: ["pages", q], queryFn: () => api.listPages(q) });
  if (pages.isPending) return <Muted sx={{ px: 1 }}>検索中…</Muted>;
  if (pages.error) return <Muted sx={{ px: 1 }}>{errorMessage(pages.error)}</Muted>;
  if (pages.data.pages.length === 0) return <Muted sx={{ px: 1 }}>「{q}」に一致するページはありません。</Muted>;
  return (
    <>
      {pages.data.pages.map((p) => (
        <RouterLink key={p.id} {...pageLink(p.id)} onClick={onNavigate} underline="none" sx={rowSx}>
          <Box component="span" sx={ellipsis}>
            {p.title}
          </Box>
        </RouterLink>
      ))}
    </>
  );
}

/** ツリーそのものの設定（表示名と、公開サイトに出すか）。 */
function TreeSettings({ tree }: { tree: StructureTree }) {
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateTree>[1]) => api.updateTree(tree.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["structure"] }),
  });
  return (
    <>
      <Tooltip title={update.error ? errorMessage(update.error) : "ツリーの設定"}>
        <IconButton size="small" aria-label="ツリーの設定" color={update.error ? "error" : "default"} onClick={(e) => setAnchor(e.currentTarget)}>
          <MoreHorizIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            const name = prompt("表示名", tree.name);
            if (name && name !== tree.name) update.mutate({ name });
          }}
        >
          名前を変更
        </MenuItem>
        <MenuItem disabled={update.isPending} onClick={() => update.mutate({ isPublic: !tree.isPublic })}>
          <Checkbox size="small" edge="start" checked={tree.isPublic} tabIndex={-1} disableRipple sx={{ p: 0, mr: 1 }} />
          公開サイトに表示
        </MenuItem>
      </Menu>
    </>
  );
}

type TreeContext = {
  childrenOf: ReadonlyMap<string | null, TreeNode[]>;
  label: (node: TreeNode) => string;
  visibility: (node: TreeNode) => Visibility;
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
  const visibility = (n: TreeNode) => (data.pages[n.pageId]?.visibility ?? "private") as Visibility;
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
    visibility,
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
  const visibility = ctx.visibility(node);

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
          <ChevronRightIcon sx={{ fontSize: 18, transition: "transform 120ms", transform: isOpen ? "rotate(90deg)" : "none" }} />
        </IconButton>
        <RouterLink {...pageLink(node.pageId)} draggable={false} onClick={ctx.onNavigate} underline="none" sx={labelSx}>
          <Box component="span" sx={ellipsis}>
            {title}
          </Box>
          <VisibilityMark visibility={visibility} />
        </RouterLink>
        <Box className="row-actions" sx={{ flexShrink: 0 }}>
          <Tooltip title="この下に新しいページ">
            <IconButton size="small" aria-label={`「${title}」の下に新しいページ`} onClick={() => ctx.onCreatePage(node.nodeId)} sx={{ p: 0.25 }}>
              <AddIcon sx={{ fontSize: 18 }} />
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

/** 限定公開・非公開のページに付ける印。公開のページには何も付けない。 */
export function VisibilityMark({ visibility }: { visibility: Visibility }) {
  if (visibility === "public") return null;
  const label = visibility === "unlisted" ? "限定公開" : "非公開";
  const Icon = visibility === "unlisted" ? LinkIcon : LockOutlinedIcon;
  return (
    <Tooltip title={label}>
      <Icon aria-label={label} role="img" sx={{ fontSize: 14, ml: 0.5, flexShrink: 0, color: "text.disabled" }} />
    </Tooltip>
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
