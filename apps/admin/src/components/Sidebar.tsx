import { Calendar, ChartColumn, Check, ChevronRight, ChevronsLeft, ChevronsUpDown, Command, History, House, Keyboard, LayoutTemplate, Link, Lock, LogOut, MonitorSmartphone, Plus, Puzzle, Search, Settings, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { GitPullRequestArrow } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
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
import Snackbar from "@mui/material/Snackbar";
import type { SxProps, Theme } from "@mui/material/styles";
import { Tooltip } from "./Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, useNavigate, useParams } from "@tanstack/react-router";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { childrenByParent, type StructureOpInput, type TreeNode, type Visibility } from "@wiki/shared";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage, type StructureResponse, type StructureTree } from "../lib/api";
import { pageLink, screenLink, useWiki, type WikiScreen } from "../lib/wiki";
import { useOpenEditRequestPageCount } from "../lib/editRequests";
import { moveStar, useStars } from "../lib/stars";
import { usePersistentState } from "../lib/storage";
import { createSelectStore, useSelect, type SelectStore } from "../lib/selectStore";
import { dropTargetOf, flattenVisible, resolveDrop, ROOT_END_DROP_ID, rowDropAt, rowDropId, type FlatRow } from "../lib/tree";
import { openShortcutGuide } from "./ShortcutGuide";
import { confirmDialog } from "./ConfirmDialog";
import { PageRowMenu, PageRowMenuButton, type RowMenuPage, type RowMenuTarget } from "./PageRowMenu";
import { WikiIcon } from "./WikiIcon";
import { Muted, RouterLink, SkeletonRows } from "./ui";

export const SIDEBAR_WIDTH = 264;
const UNTITLED = "無題";
/** これ以上動かしたらドラッグとみなす距離（px）。 */
const DRAG_DISTANCE = 4;
// ドラッグの始め方の設定は、作り直さない。作り直すと、dnd-kit が、つかめる行をすべて描き直す（サイドバーを描き直すたびに）
const MOUSE_DRAG = { activationConstraint: { distance: DRAG_DISTANCE } } as const;
const TOUCH_DRAG = { activationConstraint: { delay: 250, tolerance: 5 } } as const;

/**
 * 並び替えのドラッグの始め方。マウスは少し動かしたら、タッチは長押ししたら始める。
 * タッチで「動かしたら始める」にすると、サイドバーのスクロールと取り合いになってドラッグできない。
 */
function useDragSensors() {
  return useSensors(useSensor(MouseSensor, MOUSE_DRAG), useSensor(TouchSensor, TOUCH_DRAG));
}

/** 指で操作する端末（スマホ・タブレット）。行と行の中のボタンを大きくして、押し間違いを減らす。 */
const TOUCH = "@media (pointer: coarse)";
/** マウスで操作する端末。行のボタンは、マウスを乗せたときだけ出す。 */
const HOVER = "@media (hover: hover) and (pointer: fine)";
/** 行の中の小さなボタン（「…」、「＋」）。指で操作する端末では、ボタンごと大きくする（隣り合うので、テーマの「押せる範囲だけ広げる」は使わない）。 */
const rowButtonSx = { p: 0.25, [TOUCH]: { p: 1, "&::after": { display: "none" } } } as const;

/**
 * マウスを乗せたときだけ出すボタン（`selector`）を、マウスを乗せたとき・中にキーボードのフォーカスがあるときに出す。
 * フォーカスは `:focus-visible` で見る（`:focus-within` だと、行をクリックして開いたあとも、フォーカスが残ってボタンが出たままになる）。
 * `:has()` が使えないブラウザでは `:focus-within` で代える。
 */
const revealOnHoverOrFocus = (selector: string) =>
  ({
    [`&:hover ${selector}`]: { opacity: 1 },
    [`&:has(:focus-visible) ${selector}`]: { opacity: 1 },
    "@supports not selector(:has(*))": { [`&:focus-within ${selector}`]: { opacity: 1 } },
  }) as const;

/**
 * 行の右端のボタン（`.row-actions`）の出し方。
 * - マウスで操作する端末では、ふだんは見えなくし、行にマウスを乗せたとき・行の中にキーボードのフォーカスがあるとき・その行のメニューが開いている間だけ出す。
 *   Tab で届かなくならないよう、`display: none` ではなく透明にして隠す（幅も空けたままなので、出したときにタイトルの省略位置が動かない）
 * - 指で操作する端末などでは、乗せる操作が無く押せなくなるので、いつも薄く出しておく
 */
const rowActionsSx = {
  "& .row-actions": { display: "flex", flexShrink: 0, opacity: 0.55 },
  ...revealOnHoverOrFocus(".row-actions"),
  '& .row-actions[data-open="true"]': { opacity: 1 },
  [HOVER]: { "& .row-actions": { opacity: 0 } },
} as const;

/** 行の「…」メニューを開く。`key` は行ごとの名前 */
type OpenRowMenu = (target: RowMenuTarget) => void;

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
  // 長押しはドラッグに使うので、iOS のリンクのプレビューは出さない
  WebkitTouchCallout: "none",
  "&:hover": { bgcolor: "action.hover" },
  [TOUCH]: { minHeight: 40 },
  '&[data-status="active"], &[data-active="true"]': { bgcolor: "action.selected", color: "text.primary", fontWeight: 600 },
} as const;

const ellipsis = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** 左サイドバー：検索、画面の切り替え、ドキュメントのツリー。 */
export function Sidebar(props: {
  email: string;
  /** Google アカウントの表示名。無ければ null（メールアドレスを出す） */
  name: string | null;
  /** Google アカウントの画像の URL。無ければ null（表示名の頭文字を出す） */
  pictureUrl: string | null;
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

  // 行の「…」メニューは、サイドバーに1つだけ置く。閉じたあとも、最後に開いた行を覚えておく（閉じる動きの間、中身を出しておく）
  const [menuTarget, setMenuTarget] = useState<RowMenuTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu: OpenRowMenu = (target) => {
    setMenuTarget(target);
    setMenuOpen(true);
  };
  const openMenuKey = menuOpen ? (menuTarget?.key ?? null) : null;
  const isEmpty = tree?.nodes.length === 0;
  // ページが多いときに、ツリーの行を間引いて描くのに使う
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

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

      <Box ref={setScrollEl} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, pb: 2 }}>
        <NavItem to="/w/$wikiKey/search" icon={<Search size={18} />} onClick={props.onNavigate}>
          検索
        </NavItem>
        <NavItem to="/w/$wikiKey" exact icon={<House size={18} />} onClick={props.onNavigate}>
          すべてのページ
        </NavItem>
        <EditRequestsNavItem onClick={props.onNavigate} />
        <NavItem to="/w/$wikiKey/calendar" icon={<Calendar size={18} />} onClick={props.onNavigate}>
          編集カレンダー
        </NavItem>
        {/* Google Analytics とサーチコンソールの数字。その wiki を開ける人ならだれでも見られる */}
        <NavItem to="/w/$wikiKey/analytics" icon={<ChartColumn size={18} />} onClick={props.onNavigate}>
          アクセス解析
        </NavItem>
        <NavItem to="/w/$wikiKey/templates" icon={<LayoutTemplate size={18} />} onClick={props.onNavigate}>
          テンプレート
        </NavItem>
        <NavItem to="/w/$wikiKey/history" icon={<History size={18} />} onClick={props.onNavigate}>
          構造の履歴
        </NavItem>
        <NavItem to="/w/$wikiKey/trash" icon={<Trash2 size={18} />} onClick={props.onNavigate}>
          ゴミ箱
        </NavItem>
        {/* この wiki の設定（一般・外観・トップページ・連携・メンバー・監査ログのタブ）。どのタブを開いていても選ばれた見た目にする */}
        <NavItem to="/w/$wikiKey/settings" icon={<SlidersHorizontal size={18} />} onClick={props.onNavigate}>
          設定
        </NavItem>

        {structure.data && <StarredPages pages={structure.data.pages} openMenuKey={openMenuKey} onOpenMenu={openMenu} onNavigate={props.onNavigate} />}

        {/* 「最上位に新しいページ」も行のボタンと同じく、マウスで操作する端末では、見出しかツリーにマウスが乗っている間・キーボードのフォーカスがある間だけ出す。
            ページが1つも無いときは、作る入口が見つからなくなるので、いつも出す */}
        <Box sx={[!isEmpty && { [HOVER]: { "& .section-action": { opacity: 0 } }, ...revealOnHoverOrFocus(".section-action") }]}>
          <Box sx={{ display: "flex", alignItems: "center", mt: 2.5, mb: 0.5, pl: 1 }}>
            <Typography variant="caption" sx={{ flex: 1, color: "text.secondary", fontWeight: 600, letterSpacing: "0.04em" }}>
              ドキュメント
            </Typography>
            <Tooltip title="最上位に新しいページ">
              <span className="section-action">
                <IconButton size="small" aria-label="最上位に新しいページ" disabled={!tree || create.isPending} onClick={() => create.mutate(null)}>
                  <Plus size={18} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          {structure.isPending && <SkeletonRows rows={5} indents={[0, 16, 16, 0, 16]} />}
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
              openMenuKey={openMenuKey}
              onOpenMenu={openMenu}
              onNavigate={props.onNavigate}
              scrollEl={scrollEl}
            />
          )}
        </Box>
      </Box>
      <PageRowMenu target={menuTarget} open={menuOpen} onClose={() => setMenuOpen(false)} nodes={tree?.nodes ?? []} onNavigate={props.onNavigate} />

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

      <Box sx={{ display: "flex", borderTop: 1, borderColor: "divider" }}>
        <UserMenu email={props.email} name={props.name} pictureUrl={props.pictureUrl} onOpenCommands={props.onOpenCommands} onLogout={props.onLogout} onNavigate={props.onNavigate} />
      </Box>
    </Box>
  );
}

const MenuItemLink = createLink(MenuItem);

/**
 * 左下のユーザーメニュー。ログイン中のメールアドレスを出し、押すとメニューが上に開く。
 * コマンドメニュー（⌘K）、キーボードショートカットと記法のガイド、外部アプリ連携（wiki ごとではなく、ログインしている人の設定）への入口、ログアウトはここから行う。
 * 押せる範囲は、行の高さいっぱいに取る。
 */
function UserMenu({
  email,
  name,
  pictureUrl,
  onOpenCommands,
  onLogout,
  onNavigate,
}: {
  email: string;
  name: string | null;
  pictureUrl: string | null;
  onOpenCommands: () => void; onLogout: () => void; onNavigate?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const logoutOthers = useLogoutOthers();
  const label = name ?? email;
  // 名前があれば、メールアドレスも添えて、どのアカウントかを確かめられるようにする
  const detail = name ? `${name}（${email}）` : email;
  return (
    <>
      <Box
        component="button"
        type="button"
        title={detail}
        aria-label={`アカウントのメニューを開く（${detail}）`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 46,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          border: 0,
          borderRadius: 0,
          bgcolor: "transparent",
          color: "text.secondary",
          font: "inherit",
          fontSize: "0.875rem",
          textAlign: "left",
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {/* 画像は飾り（名前を隣に出している）ので alt は空。無い・読み込めないときは、MUI が頭文字を出す */}
        <Avatar src={pictureUrl ?? undefined} alt="" slotProps={{ img: { referrerPolicy: "no-referrer" } }} sx={{ width: 24, height: 24, fontSize: "0.75rem", flexShrink: 0 }}>
          {Array.from(label)[0]?.toUpperCase()}
        </Avatar>
        <Box component="span" sx={ellipsis}>
          {label}
        </Box>
        <Box component={ChevronsUpDown} size={18} sx={{ flexShrink: 0 }} />
      </Box>
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ list: { dense: true, sx: { minWidth: 240, maxWidth: 320 } } }}
      >
        {/* 長い名前・メールアドレスも省略せず、折り返して全体を出す */}
        <ListSubheader disableSticky sx={{ py: 0.75, lineHeight: 1.5, fontSize: "0.75rem", overflowWrap: "anywhere" }}>
          {name && <Box sx={{ fontWeight: 600, color: "text.primary" }}>{name}</Box>}
          <Box sx={{ fontWeight: name ? 400 : 600 }}>{email}</Box>
        </ListSubheader>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onOpenCommands();
          }}
        >
          <ListItemIcon>
            <Command size={18} />
          </ListItemIcon>
          <ListItemText>コマンドメニュー</ListItemText>
          {/* キーでも開けることを示す */}
          <Typography variant="body2" sx={{ ml: 2, color: "text.disabled" }}>
            ⌘K
          </Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            openShortcutGuide();
          }}
        >
          <ListItemIcon>
            <Keyboard size={18} />
          </ListItemIcon>
          <ListItemText>キーボードショートカットと記法</ListItemText>
          {/* キーでも開けることを示す */}
          <Typography variant="body2" sx={{ ml: 2, color: "text.disabled" }}>
            ?
          </Typography>
        </MenuItem>
        <MenuItemLink
          to="/connections"
          onClick={() => {
            setAnchor(null);
            onNavigate?.();
          }}
        >
          <ListItemIcon>
            <Puzzle size={18} />
          </ListItemIcon>
          <ListItemText>外部アプリ連携（MCP）</ListItemText>
        </MenuItemLink>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            logoutOthers.run();
          }}
        >
          <ListItemIcon>
            <MonitorSmartphone size={18} />
          </ListItemIcon>
          <ListItemText>ほかの端末からログアウトする</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onLogout();
          }}
        >
          <ListItemIcon>
            <LogOut size={18} />
          </ListItemIcon>
          <ListItemText>ログアウトする</ListItemText>
        </MenuItem>
      </Menu>
      {logoutOthers.notice}
    </>
  );
}

/**
 * 「ほかの端末からログアウトする」：確かめてから、この端末のほかのセッションをすべて切る。結果は左下に出す。
 * Cookie が漏れたかもしれないとき・共用の端末でログアウトし忘れたときに使う。
 */
function useLogoutOthers() {
  const [result, setResult] = useState<{ ok: true; ended: number } | { ok: false; error: Error } | null>(null);
  // 閉じるアニメーションの間も文言を出したままにする
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: api.logoutOthers,
    onSuccess: ({ ended }) => setResult({ ok: true, ended }),
    onError: (error) => setResult({ ok: false, error }),
    onSettled: () => setOpen(true),
  });
  const run = async () => {
    const ok = await confirmDialog({
      title: "ほかの端末からログアウトしますか？",
      body: "この端末のほかに、このアカウントでログインしているブラウザや端末をすべてログアウトさせます。この端末はログインしたままです。",
      confirmLabel: "ほかの端末からログアウトする",
      cancelLabel: "やめる",
    });
    if (ok) mutation.mutate();
  };
  const clear = () => setOpen(false);
  const notice = (
    <Snackbar open={open} onClose={clear} autoHideDuration={result?.ok ? 6000 : null} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
      {result?.ok === false ? (
        <Alert severity="error" variant="filled" onClose={clear}>
          ほかの端末からログアウトできませんでした。{errorMessage(result.error)}
        </Alert>
      ) : (
        <Alert severity="success" variant="filled" onClose={clear}>
          {result?.ended ? `ほかの端末（${result.ended}件）からログアウトしました` : "ほかにログインしている端末はありませんでした"}
        </Alert>
      )}
    </Snackbar>
  );
  return { run, notice };
}

/**
 * wiki の切り替え。いまどの wiki にいるかを、サイドバーの上に常に出す（表示名と、公開サイトのサブドメインになる key）。
 * 押すと、選べる wiki の一覧と、オーナーには wiki をまたぐ「全体の管理」（wiki・オーナー・すべての監査ログ）への入口を出す。
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
      {/* Slack のワークスペース一覧のように、大きめのアイコンと、表示名・key の2行を並べる。開くボタンが見出しの役をするので、一覧に見出しは置かない */}
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { "aria-label": "wiki を切り替える", sx: { minWidth: 280, maxWidth: 360 } } }}>
        {wikis.map((w) => (
          <MenuItemLink
            key={w.key}
            to="/w/$wikiKey"
            params={{ wikiKey: w.key }}
            selected={w.key === wiki.key}
            aria-current={w.key === wiki.key ? "true" : undefined}
            onClick={close}
            sx={{ gap: 1.5, minHeight: 52, py: 0.75 }}
          >
            <WikiIcon wiki={w} size={36} />
            <ListItemText
              primary={w.name}
              secondary={w.key}
              slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600, lineHeight: 1.3 } }, secondary: { noWrap: true, sx: { fontSize: "0.75rem", lineHeight: 1.3 } } }}
              sx={{ my: 0, minWidth: 0 }}
            />
            {/* いまの wiki は、背景の色だけでなくチェックの印でも示す */}
            {w.key === wiki.key && <Box component={Check} size={18} sx={{ flexShrink: 0 }} />}
          </MenuItemLink>
        ))}
        {isOwner && <Divider />}
        {isOwner && (
          <MenuItemLink to="/wikis" onClick={close} sx={{ gap: 1.5 }}>
            {/* アイコンの列の幅は、wiki の行のアイコン（36px）に揃える */}
            <Box sx={{ width: 36, display: "flex", justifyContent: "center", flexShrink: 0, color: "text.secondary" }}>
              <Settings size={18} />
            </Box>
            <ListItemText>全体の管理</ListItemText>
          </MenuItemLink>
        )}
      </Menu>
    </>
  );
}

function NavItem(props: { to: WikiScreen; exact?: boolean; icon: ReactNode; children: ReactNode; onClick?: () => void; badge?: ReactNode }) {
  return (
    <RouterLink {...screenLink(props.to)} activeOptions={{ exact: props.exact }} onClick={props.onClick} underline="none" sx={rowSx}>
      {props.icon}
      <Box component="span" sx={ellipsis}>
        {props.children}
      </Box>
      {props.badge}
    </RouterLink>
  );
}

/** 画面には出さず、読み上げにだけ出す文字 */
const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" } as const;

/**
 * 「編集リクエスト」（この wiki の一覧）。未対応のリクエストがあるページの数を、右に出す（0 のあいだと、読み込めないあいだは出さない）。
 * 数は、自分の操作のあとと、一定の間隔で取り直す（`useOpenEditRequestPageCount`）。
 */
function EditRequestsNavItem({ onClick }: { onClick?: () => void }) {
  const count = useOpenEditRequestPageCount();
  return (
    <NavItem
      to="/w/$wikiKey/requests"
      icon={<GitPullRequestArrow size={18} />}
      onClick={onClick}
      badge={
        count !== undefined && count > 0 ? (
          <>
            <Box
              component="span"
              // 数字だけでは何の数か伝わらないので、ツールチップと読み上げ（すぐ下）には言葉で出す
              aria-hidden
              title={`未対応のリクエストがあるページ ${count} 件`}
              sx={{
                flexShrink: 0,
                minWidth: 20,
                px: 0.75,
                borderRadius: 5,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                fontSize: "0.72rem",
                fontWeight: 600,
                lineHeight: "20px",
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count > 99 ? "99+" : count}
            </Box>
            <Box component="span" sx={visuallyHidden}>
              （未対応のリクエストがあるページ {count} 件）
            </Box>
          </>
        ) : undefined
      }
    >
      編集リクエスト
    </NavItem>
  );
}

/** スターを付けたページ。ツリーのどこにあっても、ここからすぐ開ける。ドラッグで並べ替えられる。1つも無ければ何も出さない。 */
function StarredPages({
  pages,
  openMenuKey,
  onOpenMenu,
  onNavigate,
}: {
  pages: StructureResponse["pages"];
  openMenuKey: string | null;
  onOpenMenu: OpenRowMenu;
  onNavigate?: () => void;
}) {
  const { ids, reorder } = useStars();
  const sensors = useDragSensors();
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
            <StarredRow key={p.id} page={p} menuOpen={openMenuKey === `star:${p.id}`} onOpenMenu={onOpenMenu} onNavigate={onNavigate} />
          ))}
        </SortableContext>
      </DndContext>
    </Box>
  );
}

function StarredRow({ page, menuOpen, onOpenMenu, onNavigate }: { page: RowMenuPage; menuOpen: boolean; onOpenMenu: OpenRowMenu; onNavigate?: () => void }) {
  const sortable = useSortable({ id: page.id });
  const { pageId: activePageId } = useParams({ strict: false });
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
      {/* 「…」をリンクの中に入れないよう、行の枠とリンクを分ける */}
      <Box data-active={page.id === activePageId} sx={{ ...rowSx, ...rowActionsSx, pr: 0.5 }}>
        <RouterLink
          {...pageLink(page.id)}
          draggable={false}
          onClick={onNavigate}
          underline="none"
          sx={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", alignItems: "center", gap: 0.75, color: "inherit" }}
        >
          <Box component={Star} size={18} fill="currentColor" sx={{ flexShrink: 0, color: "warning.main" }} />
          <EllipsisText>{page.title}</EllipsisText>
        </RouterLink>
        {/* 「…」を押しても、行のドラッグ（並べ替え）が始まらないようにする */}
        <Box className="row-actions" data-open={menuOpen} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
          <PageRowMenuButton title={page.title} open={menuOpen} onOpen={(anchor) => onOpenMenu({ key: `star:${page.id}`, page, anchor })} sx={rowButtonSx} />
        </Box>
      </Box>
    </Box>
  );
}

/**
 * ツリーの行が読む値。行は、この中の自分に関わる所だけを読み（`useSelect`）、そこが変わったときだけ描き直す。
 * props や1つのオブジェクトで配ると、メニューの開閉や現在のページが変わるたびに、すべての行を描き直すことになる。
 */
type TreeState = {
  pages: StructureResponse["pages"];
  childrenOf: ReadonlyMap<string | null, TreeNode[]>;
  collapsed: ReadonlySet<string>;
  activePageId: string | undefined;
  /** 「…」メニューを開いている行の名前（開いていなければ null） */
  openMenuKey: string | null;
  /** ドラッグ中に、落とす先になっている行と、「前へ」か「このページの下へ」か（行の上に無ければ null） */
  dropNodeId: string | null;
  dropKind: "before" | "into" | null;
  /** 折りたたみの動きの長さ。OS の「視差効果を減らす」が有効なら 0 */
  motionMs: number;
};

/** 行に渡す、作り直さないもの（作り直すと、すべての行を描き直す）。 */
type TreeContext = {
  store: SelectStore<TreeState>;
  toggle: (nodeId: string) => void;
  onCreatePage: (parentNodeId: string) => void;
  onOpenMenu: OpenRowMenu;
  onNavigate: () => void;
  /** 行を間引いて描いているか（`VIRTUALIZE_OVER` を超えている） */
  virtual: boolean;
};

/** ツリーの折りたたみの動きの長さ（ms）。 */
const TREE_MOTION_MS = 160;
/**
 * ページがこの数を超えたら、見えている行とその前後だけを描く。
 * 見えている行の数ではなく、ページの総数で決める（畳む・ひらくのたびに、描き方が入れ替わらないように）。
 */
const VIRTUALIZE_OVER = 500;
const NO_DROP = { dropNodeId: null, dropKind: null } as const;
const NO_KIDS: readonly TreeNode[] = [];

/**
 * ドラッグ中の当たり判定。ポインタの下にある落とし先を選ぶ（`pointerWithin`）。落とし先は行ごとに1つで、
 * 行の中のどこにポインタがあるかから「前へ」か「このページの下へ」かを決めて添える（`rowDropAt`）。
 * 行と行の境目ちょうどでは2つの行に当たるので、近いほうを先頭にする。
 */
const treeCollision: CollisionDetection = (args) => {
  const pointer = args.pointerCoordinates;
  if (!pointer) return [];
  return pointerWithin(args)
    .map((hit) => {
      const rect = hit.id === ROOT_END_DROP_ID ? undefined : args.droppableRects.get(hit.id);
      if (!rect) return hit;
      const { kind, distance } = rowDropAt(pointer, rect);
      return { ...hit, data: { ...hit.data, kind, value: distance } };
    })
    .sort((a, b) => (a.data?.value ?? 0) - (b.data?.value ?? 0));
};

/** 当たり判定の結果から、落とす先を求める。 */
function dropTargetOfCollisions(collisions: readonly Collision[] | null) {
  const hit = collisions?.[0];
  return hit ? dropTargetOf(String(hit.id), hit.data?.kind as "before" | "into" | undefined) : null;
}

function DocumentTree(props: {
  tree: StructureTree;
  data: StructureResponse;
  busy: boolean;
  run: (ops: StructureOpInput[]) => void;
  onCreatePage: (parentNodeId: string) => void;
  openMenuKey: string | null;
  onOpenMenu: OpenRowMenu;
  onNavigate?: () => void;
  /** サイドバーの、縦に送れる枠。行を間引いて描くとき（`VIRTUALIZE_OVER`）に、どこまで送ったかを見る */
  scrollEl: HTMLElement | null;
}) {
  const { tree, data, run } = props;
  const { pageId: activePageId } = useParams({ strict: false });
  // 既定は全展開。畳んだものだけを覚えておく（後から増えたページも開いた状態で出る）
  const [collapsedIds, setCollapsedIds] = usePersistentState<string[]>("wiki.sidebar.collapsed", []);
  const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const [dragging, setDragging] = useState<string | null>(null);
  const childrenOf = useMemo(() => childrenByParent(tree.nodes), [tree.nodes]);
  const sensors = useDragSensors();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // 行が読む値。描いたあと、画面に出る前に入れ替える（変わった所を読んでいる行だけが、続けて描き直す）
  const shown = { pages: data.pages, childrenOf, collapsed, activePageId, openMenuKey: props.openMenuKey, motionMs: reducedMotion ? 0 : TREE_MOTION_MS };
  const [store] = useState(() => createSelectStore<TreeState>({ ...shown, ...NO_DROP }));
  useLayoutEffect(() => store.set(shown));

  // 行に渡す操作は作り直さず、呼ばれたときの最新の値で動かす
  const latest = useRef({ collapsedIds, setCollapsedIds, props });
  latest.current = { collapsedIds, setCollapsedIds, props };
  const virtual = tree.nodes.length > VIRTUALIZE_OVER;
  const ctx = useMemo<TreeContext>(() => {
    const setCollapsed = (nodeId: string, next: boolean) => {
      const { collapsedIds: ids, setCollapsedIds: set } = latest.current;
      if (ids.includes(nodeId) !== next) set(next ? [...ids, nodeId] : ids.filter((id) => id !== nodeId));
    };
    return {
      store,
      toggle: (nodeId) => setCollapsed(nodeId, !latest.current.collapsedIds.includes(nodeId)),
      onCreatePage: (parentNodeId) => {
        setCollapsed(parentNodeId, false);
        latest.current.props.onCreatePage(parentNodeId);
      },
      onOpenMenu: (target) => latest.current.props.onOpenMenu(target),
      onNavigate: () => latest.current.props.onNavigate?.(),
      virtual,
    };
  }, [store, virtual]);

  /** 落とす先の目印（行の上の線・行の色）を、ポインタの下の行に出す */
  const showDrop = (e: DragMoveEvent | DragOverEvent) => {
    const target = dropTargetOfCollisions(e.collisions);
    store.set(target && target.kind !== "root-end" ? { dropNodeId: target.nodeId, dropKind: target.kind } : NO_DROP);
  };
  const endDrag = () => {
    setDragging(null);
    store.set(NO_DROP);
  };

  const onDragEnd = (e: DragEndEvent) => {
    endDrag();
    const target = e.over ? dropTargetOfCollisions(e.collisions) : null;
    if (!target) return;
    const nodeId = String(e.active.id);
    const move = resolveDrop(tree.nodes, nodeId, target);
    if (!move) return;
    // 落とした先が畳まれていたら、ひらく
    if (move.newParentNodeId && collapsed.has(move.newParentNodeId)) setCollapsedIds(collapsedIds.filter((id) => id !== move.newParentNodeId));
    run([{ type: "move", treeId: tree.id, nodeId, ...move }]);
  };

  const treeSx = [props.busy && { opacity: 0.6, pointerEvents: "none" }];
  const draggingNode = dragging ? tree.nodes.find((n) => n.nodeId === dragging) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={treeCollision}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragMove={showDrop}
      onDragOver={showDrop}
      onDragCancel={endDrag}
      onDragEnd={onDragEnd}
    >
      {virtual ? (
        <VirtualTree childrenOf={childrenOf} collapsed={collapsed} dragging={dragging} scrollEl={props.scrollEl} ctx={ctx} sx={treeSx} />
      ) : (
        <Box role="tree" aria-label="ドキュメント" sx={treeSx}>
          {(childrenOf.get(null) ?? []).map((node) => (
            <TreeRow key={node.nodeId} node={node} depth={0} ctx={ctx} />
          ))}
          {tree.nodes.length === 0 && <Muted sx={{ px: 1 }}>ページはまだありません。</Muted>}
        </Box>
      )}
      <RootEndZone active={dragging !== null} />
      <DragOverlay>
        {draggingNode && (
          <Paper variant="outlined" sx={{ px: 1, py: 0.5, fontSize: "0.9rem", borderColor: "primary.main", boxShadow: 3 }}>
            {data.pages[draggingNode.pageId]?.title ?? draggingNode.pageId}
          </Paper>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** ツリーの行と、その下の子ページの行（入れ子）。ページが少ないとき（`VIRTUALIZE_OVER` 以下）の描き方。 */
const TreeRow = memo(function TreeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeContext }) {
  const { store } = ctx;
  const kids = useSelect(store, (s) => s.childrenOf.get(node.nodeId) ?? NO_KIDS);
  const isOpen = useSelect(store, (s) => !s.collapsed.has(node.nodeId));
  const isActive = useSelect(store, (s) => s.activePageId === node.pageId);
  const motionMs = useSelect(store, (s) => s.motionMs);
  return (
    <Box role="treeitem" aria-expanded={kids.length > 0 ? isOpen : undefined} aria-selected={isActive}>
      <TreeRowBar node={node} depth={depth} ctx={ctx} />
      {kids.length > 0 && (
        // 子ページの行は、高さを動かして出し入れする。畳んでいる間は描画しない
        <Collapse in={isOpen} timeout={motionMs} unmountOnExit role="group">
          {kids.map((kid) => (
            <TreeRow key={kid.nodeId} node={kid} depth={depth + 1} ctx={ctx} />
          ))}
        </Collapse>
      )}
    </Box>
  );
});

/**
 * 行のタイトル。幅に収まらず省略されているときだけ、マウスを乗せて少し待つと全文を出す（収まっているときは何も出さない）。
 * 読み上げでは、リンクの名前で今も全文が読めるので、`aria-label` は足さない。
 */
function EllipsisText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      title={children}
      open={open}
      enterDelay={500}
      enterNextDelay={500}
      onOpen={() => setOpen(!!ref.current && ref.current.scrollWidth > ref.current.clientWidth)}
      onClose={() => setOpen(false)}
      placement="bottom-start"
    >
      <Box ref={ref} component="span" sx={ellipsis}>
        {children}
      </Box>
    </Tooltip>
  );
}

/**
 * ページが多いとき（`VIRTUALIZE_OVER` を超える）のツリー。見えている行とその前後だけを、平らに並べて描く。
 * 入れ子にしないので、階層は字下げと `aria-level` で伝える。子ページの行は、高さを動かさずにすぐ出し入れする。
 */
function VirtualTree(props: {
  childrenOf: ReadonlyMap<string | null, TreeNode[]>;
  collapsed: ReadonlySet<string>;
  dragging: string | null;
  scrollEl: HTMLElement | null;
  ctx: TreeContext;
  sx: SxProps<Theme>;
}) {
  const { scrollEl, ctx } = props;
  const rows = useMemo(() => flattenVisible(props.childrenOf, props.collapsed), [props.childrenOf, props.collapsed]);
  const coarse = useMediaQuery("(pointer: coarse)");
  const top = useRef<HTMLDivElement>(null);
  // サイドバーの縦に送れる枠の中での、ツリーの始まりの位置。上にあるスターの行が増減すると動くので、描くたびに測り直す
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!top.current || !scrollEl) return;
    const margin = top.current.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    if (Math.abs(margin - scrollMargin) > 0.5) setScrollMargin(margin);
  });
  // ドラッグしている行は、送って見えなくなっても描いたままにする（外すと、ドラッグが続かない）
  const draggingIndex = props.dragging ? rows.findIndex((r) => r.node.nodeId === props.dragging) : -1;
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return draggingIndex < 0 || indexes.includes(draggingIndex) ? indexes : [...indexes, draggingIndex].sort((a, b) => a - b);
    },
    [draggingIndex],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => (coarse ? 40 : 30),
    getItemKey: (i) => rows[i]!.node.nodeId,
    overscan: 12,
    scrollMargin,
    rangeExtractor,
  });
  // 開いたページ（今のページ）の行が見える範囲に無ければ、そこまで送る。ページが変わったとき・サイドバーを開いたときの1回だけで、
  // ユーザーが自分でツリーを送っている間（今のページが変わらない間）は、勝手に送らない
  const activePageId = useSelect(ctx.store, (s) => s.activePageId);
  const scrolledFor = useRef<string | undefined>(undefined);
  const indexOfActive = useMemo(() => (activePageId ? rows.findIndex((r) => r.node.pageId === activePageId) : -1), [rows, activePageId]);
  useEffect(() => {
    // まだ読めていない・親が畳まれているときは、行が増えたらもう一度見る
    if (!activePageId || indexOfActive < 0 || scrolledFor.current === activePageId || !scrollEl) return;
    // 描き終えて枠の位置が落ち着いてから送る（その前に送ると、仮想化の側が持っている古い位置に戻される）
    const frame = requestAnimationFrame(() => {
      scrolledFor.current = activePageId;
      virtualizer.scrollToIndex(indexOfActive, { align: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePageId, indexOfActive, scrollEl, virtualizer]);
  return (
    <Box ref={top} role="tree" aria-label="ドキュメント" sx={props.sx} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <VirtualTreeRow key={item.key} row={rows[item.index]!} index={item.index} top={item.start - scrollMargin} measure={virtualizer.measureElement} ctx={ctx} />
      ))}
    </Box>
  );
}

const VirtualTreeRow = memo(function VirtualTreeRow(props: { row: FlatRow; index: number; top: number; measure: (el: HTMLElement | null) => void; ctx: TreeContext }) {
  const { node, depth, hasChildren, indexInParent, siblings } = props.row;
  const { store } = props.ctx;
  const isOpen = useSelect(store, (s) => !s.collapsed.has(node.nodeId));
  const isActive = useSelect(store, (s) => s.activePageId === node.pageId);
  return (
    <Box
      ref={props.measure}
      data-index={props.index}
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={indexInParent}
      aria-setsize={siblings}
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
      // 位置は transform ではなく top で決める（dnd-kit は、落とし先の位置を transform を外して測る）
      style={{ position: "absolute", top: props.top, left: 0, right: 0 }}
    >
      <TreeRowBar node={node} depth={depth} ctx={props.ctx} />
    </Box>
  );
});

/** ツリーの行（1ページぶん）。ドラッグでつかむ所であり、落とす先でもある。 */
const TreeRowBar = memo(function TreeRowBar({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeContext }) {
  const { store } = ctx;
  const menuKey = `tree:${node.nodeId}`;
  const hasKids = useSelect(store, (s) => (s.childrenOf.get(node.nodeId)?.length ?? 0) > 0);
  const isOpen = useSelect(store, (s) => !s.collapsed.has(node.nodeId));
  const isActive = useSelect(store, (s) => s.activePageId === node.pageId);
  const page = useSelect(store, (s) => s.pages[node.pageId]);
  const menuOpen = useSelect(store, (s) => s.openMenuKey === menuKey);
  // 行の上 35% に落とすと「前へ」、残りに落とすと「このページの下へ」（`rowDropAt`）
  const dropKind = useSelect(store, (s) => (s.dropNodeId === node.nodeId ? s.dropKind : null));
  const moves = useSelect(store, (s) => s.motionMs > 0);
  const drag = useDraggable({ id: node.nodeId });
  const drop = useDroppable({ id: rowDropId(node.nodeId) });
  const setDragRef = drag.setNodeRef;
  const setDropRef = drop.setNodeRef;
  const barEl = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      barEl.current = el;
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef],
  );
  // 行を間引かずに描くとき（`VIRTUALIZE_OVER` 以下）の、今のページの行を見える所へ送る処理。今のページになったとき・開いたときだけで、
  // 見えているなら動かさない。間引いて描くときは `VirtualTree` が `scrollToIndex` で送る
  useEffect(() => {
    if (isActive && !ctx.virtual) barEl.current?.scrollIntoView({ block: "nearest" });
  }, [isActive, ctx.virtual]);
  const title = page?.title ?? node.pageId;
  const visibility = (page?.visibility ?? "private") as Visibility;

  // 行のアイコンは出さない（どのページも同じで見分ける手がかりにならず、タイトルの幅を狭めるため）
  // 行の高さいっぱいを押せるようにする（文字の高さだけだと、行の上下の余白を押しても開かない）
  const labelSx = { ...ellipsis, alignSelf: "stretch", display: "flex", alignItems: "center", pl: 0.25, color: "inherit", textDecoration: "none" };

  return (
    <Box
      ref={setRef}
      {...drag.listeners}
      {...drag.attributes}
      role={undefined}
      tabIndex={undefined}
      data-active={isActive}
      sx={{
        ...rowSx,
        // 行のボタン（「…」「＋」）は、マウスで操作する端末では、マウスを乗せたとき・キーボードのフォーカスがあるとき・メニューが開いている間だけ出す
        ...rowActionsSx,
        position: "relative",
        gap: 0.25,
        pl: `${4 + depth * 16}px`,
        pr: 0.5,
        opacity: drag.isDragging ? 0.4 : 1,
        boxShadow: (t) => (dropKind === "before" ? `inset 0 2px 0 ${(t.vars ?? t).palette.primary.main}` : "none"),
        ...(dropKind === "into" && { bgcolor: (t) => `color-mix(in srgb, ${(t.vars ?? t).palette.primary.main} 15%, transparent)` }),
      }}
    >
      <IconButton
        size="small"
        aria-label={isOpen ? "たたむ" : "ひらく"}
        onClick={() => ctx.toggle(node.nodeId)}
        sx={{ p: 0, width: 20, height: 20, flexShrink: 0, visibility: hasKids ? "visible" : "hidden", [TOUCH]: { width: 32, height: 36, "&::after": { display: "none" } } }}
      >
        {/* 矢印の向きも、「視差効果を減らす」が有効なら動かさずに切り替える（子ページの行の出し入れと揃える） */}
        <Box component={ChevronRight} size={18} sx={{ transition: moves ? "transform 120ms" : "none", transform: isOpen ? "rotate(90deg)" : "none" }} />
      </IconButton>
      <RouterLink {...pageLink(node.pageId)} draggable={false} onClick={ctx.onNavigate} underline="none" sx={labelSx}>
        <EllipsisText>{title}</EllipsisText>
        <VisibilityMark visibility={visibility} />
      </RouterLink>
      <Box className="row-actions" data-open={menuOpen}>
        {page && <PageRowMenuButton title={title} open={menuOpen} onOpen={(anchor) => ctx.onOpenMenu({ key: menuKey, page, anchor })} sx={rowButtonSx} />}
        <Tooltip title="この下に新しいページ">
          <IconButton size="small" aria-label={`「${title}」の下に新しいページ`} onClick={() => ctx.onCreatePage(node.nodeId)} sx={rowButtonSx}>
            <Plus size={18} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});

/** 限定公開・非公開のページに付ける印。公開のページには何も付けない。 */
export function VisibilityMark({ visibility }: { visibility: Visibility }) {
  if (visibility === "public") return null;
  const label = visibility === "unlisted" ? "限定公開" : "非公開";
  const Icon = visibility === "unlisted" ? Link : Lock;
  return (
    <Tooltip title={label}>
      <Box component="span" role="img" aria-label={label} sx={{ display: "inline-flex", ml: 0.5, flexShrink: 0, color: "text.disabled" }}>
        <Icon size={14} />
      </Box>
    </Tooltip>
  );
}

/** ツリーの下の余白。ドラッグ中だけ「最上位の末尾へ」の落とし先として見せる。 */
function RootEndZone({ active }: { active: boolean }) {
  const drop = useDroppable({ id: ROOT_END_DROP_ID });
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
