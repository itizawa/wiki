import { Copy, Download, Ellipsis } from "lucide-react";
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

/** 編集画面の「…」メニュー。いま画面にある内容（保存前の変更も含む）を Markdown で持ち出す。 */
export function PageMenu({ title, bodyMd }: { title: string; bodyMd: string }) {
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
      <Tooltip title="書き出す">
        <IconButton size="small" aria-label="書き出す" aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>
          <Ellipsis size={18} />
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true } }}>
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
