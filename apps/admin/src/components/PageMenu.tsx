import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { Copy, Download, Ellipsis, History, LayoutTemplate, Trash2 } from "lucide-react";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { markdownFileName, toMarkdownDocument } from "../lib/export";
import { setPageActions } from "../lib/pageActions";
import { templateLink } from "../lib/wiki";
import { Tooltip } from "./Tooltip";

/**
 * 編集画面の「…」メニュー。版履歴を開く・いま画面にある内容（保存前の変更も含む）を Markdown で持ち出す・テンプレートにする・ページを削除する。
 */
export function PageMenu(props: { title: string; bodyMd: string; onOpenHistory: () => void; onDelete: () => void }) {
  const { title, bodyMd } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdTemplate, setCreatedTemplate] = useState<string | null>(null);

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
          <Ellipsis size={18} />
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
            <History size={18} />
          </ListItemIcon>
          <ListItemText>版履歴</ListItemText>
        </MenuItem>
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
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={18} />
          </ListItemIcon>
          <ListItemText>このページを削除…</ListItemText>
        </MenuItem>
      </Menu>
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
