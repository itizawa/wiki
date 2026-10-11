import { ArrowLeftRight, Calendar, ChartColumn, ClipboardList, Copy, Download, FileText, History, House, Keyboard, LayoutTemplate, LogOut, Palette, PanelLeft, PanelsTopLeft, Plug, Plus, Presentation, Replace, Save, Search, SlidersHorizontal, Trash2, Users } from "lucide-react";
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
import { pageLink, screenLink, useWiki, type WikiScreen } from "../lib/wiki";
import { openFindBar } from "../editor/findBarState";
import { usePageActions } from "../lib/pageActions";
import { useCreateFromTemplate } from "../lib/createFromTemplate";
import { openShortcutGuide } from "./ShortcutGuide";
import { Muted } from "./ui";

const MAX_PAGES = 8;

type Item = { key: string; label: string; secondary?: string; icon: ReactNode; run: () => void };

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

  // 検索の画面と同じ検索（タイトルと本文）。何も打っていなければ、最近更新したページ
  const pages = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: open, placeholderData: keepPreviousData });
  const create = useMutation({
    mutationFn: () => api.createPage({ title: q || "無題" }),
    onSuccess: async (page) => {
      void qc.invalidateQueries({ queryKey: ["structure"] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      onClose();
      await navigate(pageLink(page.id));
    },
  });

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates, enabled: open });
  const fromTemplate = useCreateFromTemplate();

  const { wiki, wikis, role } = useWiki();
  // メニューを閉じてから実行する操作
  const closing = (run: () => void) => () => {
    onClose();
    run();
  };
  const go = (to: WikiScreen) => () => {
    onClose();
    void navigate(screenLink(to));
  };
  const commands: Command[] = [
    {
      id: "new",
      label: q ? `「${q}」という名前で新しいページを作る` : "新しいページを作る",
      keywords: ["new", "create", "page", "tsukuru"],
      icon: <Plus size={18} />,
      run: () => !create.isPending && create.mutate(),
    },
    // テンプレートの名前でも探せる。タイトルはテンプレートのもの（変数を置き換えたもの）になる
    ...(templates.data?.templates ?? []).map((t) => ({
      id: `template:${t.id}`,
      label: `テンプレート「${t.title}」で新しいページを作る`,
      keywords: ["template", "new", "create"],
      icon: <LayoutTemplate size={18} />,
      run: () => {
        if (fromTemplate.isPending) return;
        onClose();
        fromTemplate.mutate({ templateId: t.id });
      },
    })),
    {
      id: "search",
      label: q ? `「${q}」の検索結果を、本文の一致した所と一緒に見る` : "「検索」を開く",
      keywords: ["search", "find", "kensaku"],
      icon: <Search size={18} />,
      run: () => {
        onClose();
        void navigate({ ...screenLink("/w/$wikiKey/search"), search: q ? { q } : {} });
      },
    },
    { id: "pages", label: "「すべてのページ」を開く", keywords: ["pages", "home", "list"], icon: <House size={18} />, run: go("/w/$wikiKey") },
    { id: "calendar", label: "「編集カレンダー」を開く", keywords: ["calendar", "schedule"], icon: <Calendar size={18} />, run: go("/w/$wikiKey/calendar") },
    {
      id: "analytics",
      label: "「アクセス解析」を開く",
      keywords: ["analytics", "ga", "google", "search console", "access", "kaiseki"],
      icon: <ChartColumn size={18} />,
      run: go("/w/$wikiKey/analytics"),
    },
    { id: "templates", label: "「テンプレート」を開く", keywords: ["templates"], icon: <LayoutTemplate size={18} />, run: go("/w/$wikiKey/templates") },
    { id: "history", label: "「構造の履歴」を開く", keywords: ["history", "commits"], icon: <History size={18} />, run: go("/w/$wikiKey/history") },
    { id: "members", label: "「メンバー」を開く", keywords: ["members", "invite", "users"], icon: <Users size={18} />, run: go("/w/$wikiKey/settings/members") },
    // 監査ログは管理者だけ
    ...(role === "admin"
      ? [{ id: "audit", label: "「監査ログ」を開く", keywords: ["audit", "log", "kansa"], icon: <ClipboardList size={18} />, run: go("/w/$wikiKey/settings/audit") }]
      : []),
    // 外観は管理者だけが開ける
    ...(role === "admin"
      ? [{ id: "appearance", label: "「外観」を開く", keywords: ["appearance", "theme", "color", "logo", "favicon"], icon: <Palette size={18} />, run: go("/w/$wikiKey/settings/appearance") }]
      : []),
    // トップページ（公開サイトのトップの自由記述）も管理者だけ
    ...(role === "admin"
      ? [{ id: "home", label: "「トップページ」を開く", keywords: ["home", "top", "intro", "toppage"], icon: <PanelsTopLeft size={18} />, run: go("/w/$wikiKey/settings/home") }]
      : []),
    { id: "trash", label: "「ゴミ箱」を開く", keywords: ["trash", "deleted", "restore", "gomibako"], icon: <Trash2 size={18} />, run: go("/w/$wikiKey/trash") },
    {
      id: "settings",
      label: "「設定」を開く",
      keywords: ["settings", "settei", "general", "name", "icon", "wiki"],
      icon: <SlidersHorizontal size={18} />,
      run: go("/w/$wikiKey/settings"),
    },
    // 連携（GA・サーチコンソール）は、設定の中のタブを直接開ける
    {
      id: "integrations",
      label: "「連携」を開く",
      keywords: ["integrations", "analytics", "ga", "google", "search console", "renkei"],
      icon: <Plug size={18} />,
      run: go("/w/$wikiKey/settings/integrations"),
    },
    // 探せるページと操作は、開いている wiki のものだけ。ほかの wiki へは、ここから切り替える
    ...wikis
      .filter((w) => w.key !== wiki.key)
      .map((w) => ({
        id: `wiki:${w.key}`,
        label: `wiki「${w.name}」に切り替える`,
        keywords: ["wiki", "switch", w.key],
        icon: <ArrowLeftRight size={18} />,
        run: () => {
          onClose();
          void navigate({ to: "/w/$wikiKey", params: { wikiKey: w.key } });
        },
      })),
    // 編集画面を開いているときだけ出す。いま画面にある内容（保存前の変更も含む）を持ち出す・スライドにする
    ...(pageActions
      ? [
          { id: "present", label: "このページをプレゼンモードで表示", keywords: ["present", "slide", "presentation"], icon: <Presentation size={18} />, run: closing(pageActions.present) },
          { id: "find", label: "本文を検索・置換する", keywords: ["find", "search", "replace", "kensaku"], icon: <Replace size={18} />, run: closing(openFindBar) },
          { id: "keep-version", label: "いまの内容を版として残す", keywords: ["save", "version", "keep", "hozon"], icon: <Save size={18} />, run: closing(pageActions.keepVersion) },
          { id: "copy-md", label: "このページの Markdown をコピー", keywords: ["copy", "markdown", "md", "export"], icon: <Copy size={18} />, run: closing(pageActions.copyMarkdown) },
          {
            id: "download-md",
            label: "このページの Markdown ファイル（.md）をダウンロード",
            keywords: ["download", "markdown", "md", "export"],
            icon: <Download size={18} />,
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
            icon: <PanelLeft size={18} />,
            run: () => {
              onClose();
              props.onToggleSidebar?.();
            },
          },
        ]
      : []),
    { id: "shortcuts", label: "キーボードショートカットと記法の一覧を開く", keywords: ["shortcut", "keyboard", "help", "markdown", "?"], icon: <Keyboard size={18} />, run: closing(openShortcutGuide) },
    {
      id: "logout",
      label: "ログアウトする",
      keywords: ["logout", "signout"],
      icon: <LogOut size={18} />,
      run: () => {
        onClose();
        props.onLogout();
      },
    },
  ];

  const pageItems = (pages.data?.results ?? []).slice(0, MAX_PAGES);
  // 「新しいページを作る」と検索は、打った文字が何であっても残す（その文字で作る・探すため）
  const matched = filterCommands(commands.slice(2), q);
  const actions = [commands[0]!, commands[1]!, ...matched];
  // 探しているときはページを先に、何も打っていないときは操作を先に出す
  const sections: { title: string; items: Item[] }[] = [
    { title: "ページ", items: pageItems.map((p) => ({ key: p.id, label: p.title, secondary: p.snippet ?? undefined, icon: <FileText size={18} />, run: () => openPage(p.id) })) },
    { title: "操作", items: actions.map((c) => ({ key: c.id, label: c.label, icon: c.icon, run: c.run })) },
  ];
  if (q === "") sections.reverse();
  const flat = sections.flatMap((s) => s.items);
  const active = Math.min(index, flat.length - 1);

  function openPage(pageId: string) {
    onClose();
    void navigate(pageLink(pageId));
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
        <Box component={Search} size={18} sx={{ color: "text.secondary" }} />
        <InputBase
          inputRef={inputRef}
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ページを探す（タイトルと本文）、または操作を選ぶ"
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
                  <ListItemText primary={item.label} secondary={item.secondary} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true, sx: { fontSize: "0.75rem" } } }} />
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
