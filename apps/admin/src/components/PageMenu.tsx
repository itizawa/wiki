import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import {
  Copy,
  Download,
  Ellipsis,
  GitPullRequestArrow,
  Globe,
  History,
  LayoutTemplate,
  Presentation as PresentationIcon,
  Save,
  Search,
  SmilePlus,
  Star,
  TableOfContents,
  Trash2,
} from "lucide-react";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLink, useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/react";
import type { PageDetail } from "@wiki/shared";
import { useEffect, useRef, useState } from "react";
import { openFindBar } from "../editor/findBarState";
import { OutlinePopover } from "../editor/Outline";
import type { OutlineHeading } from "../editor/outlineHeadings";
import { api, errorMessage } from "../lib/api";
import { COPY_FAILED_MESSAGE, copyText } from "../lib/clipboard";
import { editRequestsLink } from "../lib/editRequests";
import { markdownFileName, toMarkdownDocument } from "../lib/export";
import { setPageActions } from "../lib/pageActions";
import { useStars } from "../lib/stars";
import { templateLink } from "../lib/wiki";
import { TOUCH } from "../theme";
import { Presentation } from "./Presentation";
import { PublishSheet, usePublishState } from "./PublishMenu";
import type { EnsureVersion } from "./PublishPanel";
import { modKey } from "./ShortcutGuide";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

const MenuItemLink = createLink(MenuItem);

/**
 * 編集画面の「…」メニュー。本文を検索・置換する・プレゼンモードで表示する・アイコン（絵文字）を付ける・いまの内容を版として残す・版履歴を開く・いま画面にある内容（版になる前の変更も含む）を Markdown で持ち出す・
 * テンプレートにする・ページをゴミ箱に入れる。
 *
 * スマホ幅（`narrow`）では、ヘッダーに置けない操作（公開・予約、スター、目次）も、このメニューの先頭に並べる。
 */
export function PageMenu(props: {
  pageId: string;
  title: string;
  bodyMd: string;
  /** アイコン（絵文字）が付いているか */
  hasIcon: boolean;
  /** アイコンを選ぶ画面を開く（タイトルのそばのボタンと同じ） */
  onPickIcon: () => void;
  /** いまの内容を版として残す（⌘S と同じ）。結果の知らせは、呼ばれた側が出す */
  onKeepVersion: () => void;
  onOpenHistory: () => void;
  /** 未対応の編集リクエストの項目の数。読み込み中は undefined（件数を出さない） */
  openEditRequests: number | undefined;
  onDelete: () => void;
  /** スマホ幅か。ヘッダーの「…」以外のボタンの代わりを、このメニューに出す */
  narrow: boolean;
  page: PageDetail;
  /** まだ版になっていない変更があるか（公開・予約の前に版にする） */
  dirty: boolean;
  ensureVersion: EnsureVersion;
  editor: Editor | null;
  /** 目次に出す見出し。無ければ「目次」は出さない */
  headings: OutlineHeading[];
}) {
  const { title, bodyMd } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 「…」ボタン。メニューを閉じたあとに開く目次の基準と、プレゼンモードを閉じたあとのフォーカスの戻り先
  const menuButton = useRef<HTMLButtonElement>(null);
  const [createdTemplate, setCreatedTemplate] = useState<string | null>(null);
  // スマホ幅でだけメニューから開くもの。開いたあとに幅が広がっても、閉じるまでは出しておく
  const [publishOpen, setPublishOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const publishLabel = usePublishState(props.page).label;
  const stars = useStars();
  const starred = stars.ids.includes(props.pageId);
  // プレゼンモード。いま画面にある内容（版になる前の変更も含む）を、そのままスライドにする
  const [presenting, setPresenting] = useState(false);
  const present = () => {
    setAnchor(null);
    setPresenting(true);
  };

  const saveAsTemplate = useMutation({
    mutationFn: () => api.createTemplate({ title: title.trim() || "無題", bodyMd }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      setCreatedTemplate(t.id);
      setNotice(`テンプレート「${t.title}」を作りました`);
    },
    onError: (err) => {
      setCreatedTemplate(null);
      setNotice(`テンプレートを作れませんでした：${errorMessage(err)}`);
    },
  });

  const copy = async () => {
    setAnchor(null);
    setCreatedTemplate(null);
    await copyText(
      toMarkdownDocument(title, bodyMd),
      () => setNotice("Markdown をコピーしました"),
      () => setNotice(COPY_FAILED_MESSAGE),
    );
  };

  const download = () => {
    setAnchor(null);
    const url = URL.createObjectURL(new Blob([toMarkdownDocument(title, bodyMd)], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = markdownFileName(title);
    a.click();
    URL.revokeObjectURL(url);
  };

  // コマンドメニュー（⌘K）からも同じ操作を呼べるようにする。結果の知らせは、ここの Snackbar に出す
  const actions = useRef({ copy, download, keepVersion: props.onKeepVersion, present });
  actions.current = { copy, download, keepVersion: props.onKeepVersion, present };
  useEffect(() => {
    setPageActions({
      copyMarkdown: () => void actions.current.copy(),
      downloadMarkdown: () => actions.current.download(),
      keepVersion: () => actions.current.keepVersion(),
      present: () => actions.current.present(),
    });
    return () => setPageActions(null);
  }, []);

  return (
    <>
      <Tooltip title="その他の操作">
        <IconButton ref={menuButton} size="small" aria-label="その他の操作" aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)} sx={{ [TOUCH]: { width: 40, height: 40 } }}>
          <Ellipsis size={18} />
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        {props.narrow && [
          <MenuItem
            key="publish"
            aria-haspopup="dialog"
            onClick={() => {
              setAnchor(null);
              setPublishOpen(true);
            }}
          >
            <ListItemIcon>
              <Globe size={18} />
            </ListItemIcon>
            <ListItemText>公開・予約</ListItemText>
            {/* いまの公開範囲。ヘッダーのボタンに出していたもの */}
            <Muted component="span" sx={{ ml: 3, fontSize: "0.75rem" }}>
              {publishLabel}
            </Muted>
          </MenuItem>,
          <MenuItem
            key="star"
            onClick={() => {
              setAnchor(null);
              stars.toggle(props.pageId);
            }}
          >
            <ListItemIcon>
              <Star size={18} fill={starred ? "currentColor" : "none"} />
            </ListItemIcon>
            <ListItemText>{starred ? "スターを外す" : "スターを付ける"}</ListItemText>
          </MenuItem>,
          props.headings.length > 0 && (
            <MenuItem
              key="outline"
              aria-haspopup="dialog"
              onClick={() => {
                setAnchor(null);
                setOutlineOpen(true);
              }}
            >
              <ListItemIcon>
                <TableOfContents size={18} />
              </ListItemIcon>
              <ListItemText>目次</ListItemText>
            </MenuItem>
          ),
          <Divider key="divider" />,
        ]}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            openFindBar();
          }}
        >
          <ListItemIcon>
            <Search size={18} />
          </ListItemIcon>
          <ListItemText>本文を検索・置換</ListItemText>
          <Muted component="span" sx={{ ml: 3, fontSize: "0.75rem" }}>
            {modKey()}F
          </Muted>
        </MenuItem>
        <MenuItem aria-haspopup="dialog" onClick={present}>
          <ListItemIcon>
            <PresentationIcon size={18} />
          </ListItemIcon>
          <ListItemText>プレゼンモードで表示</ListItemText>
        </MenuItem>
        <MenuItem
          aria-haspopup="dialog"
          onClick={() => {
            setAnchor(null);
            props.onPickIcon();
          }}
        >
          <ListItemIcon>
            <SmilePlus size={18} />
          </ListItemIcon>
          <ListItemText>{props.hasIcon ? "アイコンを変える…" : "アイコンを付ける…"}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            props.onKeepVersion();
          }}
        >
          <ListItemIcon>
            <Save size={18} />
          </ListItemIcon>
          <ListItemText>いまの内容を版として残す</ListItemText>
          <Muted component="span" sx={{ ml: 3, fontSize: "0.75rem" }}>
            {modKey()}S
          </Muted>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            props.onOpenHistory();
          }}
        >
          <ListItemIcon>
            <History size={18} />
          </ListItemIcon>
          <ListItemText>版履歴</ListItemText>
        </MenuItem>
        {/* レビュー画面へ移る（画面が変わるので、リンクにする）。未対応が0件でも、これまでの提案を見られる */}
        <MenuItemLink {...editRequestsLink(props.pageId)} onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <GitPullRequestArrow size={18} />
          </ListItemIcon>
          <ListItemText>編集リクエスト</ListItemText>
          {props.openEditRequests !== undefined && (
            <Muted component="span" sx={{ ml: 3, fontSize: "0.75rem" }}>
              未対応 {props.openEditRequests} 件
            </Muted>
          )}
        </MenuItemLink>
        <Divider />
        <MenuItem onClick={copy}>
          <ListItemIcon>
            <Copy size={18} />
          </ListItemIcon>
          <ListItemText>Markdown をコピー</ListItemText>
        </MenuItem>
        <MenuItem onClick={download}>
          <ListItemIcon>
            <Download size={18} />
          </ListItemIcon>
          <ListItemText>Markdown ファイル（.md）をダウンロード</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={saveAsTemplate.isPending}
          onClick={() => {
            setAnchor(null);
            setCreatedTemplate(null);
            saveAsTemplate.mutate();
          }}
        >
          <ListItemIcon>
            <LayoutTemplate size={18} />
          </ListItemIcon>
          <ListItemText>テンプレートとして保存</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            props.onDelete();
          }}
        >
          {/* ゴミ箱から元に戻せるので、赤にはしない */}
          <ListItemIcon>
            <Trash2 size={18} />
          </ListItemIcon>
          <ListItemText>ゴミ箱に入れる…</ListItemText>
        </MenuItem>
      </Menu>
      {/* 終了したら、フォーカスを「…」ボタンに戻す */}
      <Presentation open={presenting} title={title} bodyMd={bodyMd} onClose={() => setPresenting(false)} onExited={() => menuButton.current?.focus({ preventScroll: true })} />
      <PublishSheet page={props.page} dirty={props.dirty} ensureVersion={props.ensureVersion} open={publishOpen} onClose={() => setPublishOpen(false)} />
      {props.editor && (
        <OutlinePopover editor={props.editor} headings={props.headings} anchorEl={menuButton.current} open={outlineOpen} onClose={() => setOutlineOpen(false)} />
      )}
      {/* 結果は、押したメニューの近く（右上）に出す */}
      <Snackbar
        open={notice !== null}
        message={notice}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        action={
          createdTemplate && (
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setNotice(null);
                void navigate(templateLink(createdTemplate));
              }}
            >
              開く
            </Button>
          )
        }
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ mt: 5 }}
      />
    </>
  );
}
