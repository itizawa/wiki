import AddIcon from "@mui/icons-material/Add";
import AutoModeIcon from "@mui/icons-material/AutoMode";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import HistoryIcon from "@mui/icons-material/History";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import SearchIcon from "@mui/icons-material/Search";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import InputBase from "@mui/material/InputBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import { usePageActions } from "../lib/pageActions";
import { openShortcutGuide } from "./ShortcutGuide";
import { Muted } from "./ui";

const MAX_PAGES = 8;

type Item = { key: string; label: string; icon: ReactNode; run: () => void };

export type Command = { id: string; label: string; keywords: string[]; icon: ReactNode; run: () => void };

/** 打った文字に当たる操作だけを残す（名前の一部か、英語などの別名の先頭に一致）。 */
export function filterCommands<T extends Pick<Command, "label" | "keywords">>(commands: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return commands;
  return commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.startsWith(q)));
}

/** ⌘K（Ctrl+K）で開くコマンドメニュー。ページを探して開く、画面を移る、よく使う操作をキーボードだけで行う。 */
export function CommandMenu(props: { open: boolean; onClose: () => void; onToggleSidebar?: () => void; onLogout: () => void }) {
  const { open, onClose } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();
  const pageActions = usePageActions();

  const pages = useQuery({ queryKey: ["pages", q], queryFn: () => api.listPages(q), enabled: open, placeholderData: keepPreviousData });
  const create = useMutation({
    mutationFn: () => api.createPage({ title: q || "無題" }),
    onSuccess: async (page) => {
      void qc.invalidateQueries({ queryKey: ["structure"] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      onClose();
      await navigate({ to: "/pages/$pageId", params: { pageId: page.id } });
    },
  });

  // メニューを閉じてから実行する操作
  const closing = (run: () => void) => () => {
    onClose();
    run();
  };
  const go = (to: "/" | "/calendar" | "/rules" | "/history") => () => {
    onClose();
    void navigate({ to });
  };
  const commands: Command[] = [
    {
      id: "new",
      label: q ? `「${q}」という名前で新しいページを作る` : "新しいページを作る",
      keywords: ["new", "create", "page", "tsukuru"],
      icon: <AddIcon fontSize="small" />,
      run: () => !create.isPending && create.mutate(),
    },
    { id: "pages", label: "「すべてのページ」を開く", keywords: ["pages", "home", "list"], icon: <HomeOutlinedIcon fontSize="small" />, run: go("/") },
    { id: "calendar", label: "「編集カレンダー」を開く", keywords: ["calendar", "schedule"], icon: <CalendarMonthOutlinedIcon fontSize="small" />, run: go("/calendar") },
    { id: "rules", label: "「ルール」を開く", keywords: ["rules", "workflow"], icon: <AutoModeIcon fontSize="small" />, run: go("/rules") },
    { id: "history", label: "「構造の履歴」を開く", keywords: ["history", "commits"], icon: <HistoryIcon fontSize="small" />, run: go("/history") },
    // 編集画面を開いているときだけ出す。いま画面にある内容（保存前の変更も含む）を持ち出す
    ...(pageActions
      ? [
          { id: "copy-md", label: "このページの Markdown をコピー", keywords: ["copy", "markdown", "md", "export"], icon: <ContentCopyIcon fontSize="small" />, run: closing(pageActions.copyMarkdown) },
          {
            id: "download-md",
            label: "このページの Markdown ファイル（.md）をダウンロード",
            keywords: ["download", "markdown", "md", "export"],
            icon: <FileDownloadOutlinedIcon fontSize="small" />,
            run: closing(pageActions.downloadMarkdown),
          },
        ]
      : []),
    ...(props.onToggleSidebar
      ? [
          {
            id: "sidebar",
            label: "サイドバーを開く／閉じる",
            keywords: ["sidebar", "toggle"],
            icon: <ViewSidebarOutlinedIcon fontSize="small" />,
            run: () => {
              onClose();
              props.onToggleSidebar?.();
            },
          },
        ]
      : []),
    { id: "shortcuts", label: "キーボードショートカットと記法の一覧を開く", keywords: ["shortcut", "keyboard", "help", "markdown", "?"], icon: <KeyboardOutlinedIcon fontSize="small" />, run: closing(openShortcutGuide) },
    {
      id: "logout",
      label: "ログアウトする",
      keywords: ["logout", "signout"],
      icon: <LogoutIcon fontSize="small" />,
      run: () => {
        onClose();
        props.onLogout();
      },
    },
  ];

  const pageItems = (pages.data?.pages ?? []).slice(0, MAX_PAGES);
  // 「新しいページを作る」は、打った文字が何であっても残す（その名前で作れるため）
  const matched = filterCommands(commands.slice(1), q);
  const actions = [commands[0]!, ...matched];
  // 探しているときはページを先に、何も打っていないときは操作を先に出す
  const sections: { title: string; items: Item[] }[] = [
    { title: "ページ", items: pageItems.map((p) => ({ key: p.id, label: p.title, icon: <DescriptionOutlinedIcon fontSize="small" />, run: () => openPage(p.id) })) },
    { title: "操作", items: actions.map((c) => ({ key: c.id, label: c.label, icon: c.icon, run: c.run })) },
  ];
  if (q === "") sections.reverse();
  const flat = sections.flatMap((s) => s.items);
  const active = Math.min(index, flat.length - 1);

  function openPage(pageId: string) {
    onClose();
    void navigate({ to: "/pages/$pageId", params: { pageId } });
  }

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    if (open) {
      setQuery("");
      create.reset();
    }
    // 開くたびに入力を空に戻す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }} slotProps={{ paper: { sx: { mt: "12vh" } }, transition: { onEntering: () => inputRef.current?.focus() } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25 }}>
        <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <InputBase
          inputRef={inputRef}
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ページを探す、または操作を選ぶ"
          inputProps={{ "aria-label": "ページを探す、または操作を選ぶ", role: "combobox", "aria-expanded": true, "aria-controls": "command-menu-list" }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((active + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              flat[active]?.run();
            }
          }}
        />
        <Muted sx={{ flexShrink: 0, fontSize: "0.75rem" }}>Esc で閉じる</Muted>
      </Box>
      <Divider />
      <MenuList id="command-menu-list" dense role="listbox" aria-label="候補" sx={{ maxHeight: "50vh", overflowY: "auto", py: 0.5 }}>
        {sections.flatMap((section) => {
          if (section.items.length === 0) return [];
          return [
            <ListSubheader key={section.title} disableSticky sx={{ lineHeight: "28px", fontSize: "0.75rem", fontWeight: 600 }}>
              {section.title}
            </ListSubheader>,
            ...section.items.map((item) => {
              const selected = flat[active] === item;
              return (
                <MenuItem key={item.key} role="option" aria-selected={selected} selected={selected} ref={selected ? scrollIntoView : undefined} onClick={item.run}>
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText slotProps={{ primary: { noWrap: true } }}>{item.label}</ListItemText>
                </MenuItem>
              );
            }),
          ];
        })}
      </MenuList>
      {q !== "" && pages.data && pageItems.length === 0 && matched.length === 0 && (
        <Muted sx={{ px: 2, pb: 1.5 }}>「{q}」に一致するページや操作はありません。上の項目から、この名前でページを作れます。</Muted>
      )}
      {(create.error ?? pages.error) && (
        <Muted role="alert" sx={{ px: 2, pb: 1.5, color: "error.main" }}>
          {errorMessage(create.error ?? pages.error)}
        </Muted>
      )}
    </Dialog>
  );
}

const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });
