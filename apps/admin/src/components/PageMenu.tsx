import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import HistoryIcon from "@mui/icons-material/History";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import { useEffect, useRef, useState } from "react";
import { markdownFileName, toMarkdownDocument } from "../lib/export";
import { setPageActions } from "../lib/pageActions";
import { Tooltip } from "./Tooltip";
import { Mono, Muted } from "./ui";

/**
 * 編集画面の「…」メニュー。版履歴を開く・いま画面にある内容（保存前の変更も含む）を Markdown で持ち出す・ページを削除する。
 * 下にページのパスを出す。
 */
export function PageMenu(props: { title: string; bodyMd: string; path: string; onOpenHistory: () => void; onDelete: () => void }) {
  const { title, bodyMd } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = async () => {
    setAnchor(null);
    try {
      await navigator.clipboard.writeText(toMarkdownDocument(title, bodyMd));
      setNotice("Markdown をコピーしました");
    } catch {
      setNotice("コピーできませんでした。ブラウザでクリップボードの利用を許可してください");
    }
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
  const actions = useRef({ copy, download });
  actions.current = { copy, download };
  useEffect(() => {
    setPageActions({ copyMarkdown: () => void actions.current.copy(), downloadMarkdown: () => actions.current.download() });
    return () => setPageActions(null);
  }, []);

  return (
    <>
      <Tooltip title="その他の操作">
        <IconButton size="small" aria-label="その他の操作" aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            props.onOpenHistory();
          }}
        >
          <ListItemIcon>
            <HistoryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>版履歴</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={copy}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Markdown をコピー</ListItemText>
        </MenuItem>
        <MenuItem onClick={download}>
          <ListItemIcon>
            <FileDownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Markdown ファイル（.md）をダウンロード</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            props.onDelete();
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>このページを削除…</ListItemText>
        </MenuItem>
        <Muted component="div" sx={{ px: 2, pt: 1, pb: 0.5, fontSize: "0.75rem", wordBreak: "break-all" }}>
          <Mono>{props.path}</Mono>
        </Muted>
      </Menu>
      {/* 結果は、押したメニューの近く（右上）に出す */}
      <Snackbar
        open={notice !== null}
        message={notice}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ mt: 5 }}
      />
    </>
  );
}
