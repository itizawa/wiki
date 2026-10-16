import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import { Copy, Ellipsis, Presentation, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { canShare, copyUrl, sharePage } from "../lib/sharePage";
import { MENU_BUTTON_ATTR, PRESENT_EVENT, PRESENTABLE_ATTR, PRESENTABLE_EVENT } from "../lib/presentable";

const subscribe = (onChange: () => void) => {
  document.addEventListener(PRESENTABLE_EVENT, onChange);
  return () => document.removeEventListener(PRESENTABLE_EVENT, onChange);
};
const isPresentable = () => document.documentElement.hasAttribute(PRESENTABLE_ATTR);
const noSubscribe = () => () => {};
const itemSx = { "&:hover, &.Mui-focusVisible": { bgcolor: "var(--bg)" } };

/**
 * ヘッダー右端の「…」メニュー（管理画面のページのメニューと同じ MUI の Menu）。色は、wiki のテーマの CSS 変数から取る。
 * 全ページに出す。「URLをコピー」は常に、「共有」は Web Share API（navigator.share）が使える環境だけ、「プレゼンモードで表示」はスライドが2枚以上の記事だけ。
 * 検索と RSS はサイドバー（NavDrawer.astro）
 */
export default function SiteMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const presentable = useSyncExternalStore(subscribe, isPresentable, () => false);
  // サーバーとの描き分けでずれないよう、ブラウザの機能は購読の形で読む（サーバーでは「共有」を出さない）
  const shareable = useSyncExternalStore(noSubscribe, () => canShare(navigator), () => false);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setAnchor(null);
  const pageUrl = () => location.href;

  const onCopy = async () => {
    close();
    setNotice((await copyUrl(navigator, pageUrl())) ? "URLをコピーしました" : "URLをコピーできませんでした");
  };
  const onShare = async () => {
    close();
    if ((await sharePage(navigator, { title: document.title, url: pageUrl() })) === "failed") setNotice("共有できませんでした");
  };

  return (
    <>
      <IconButton
        {...{ [MENU_BUTTON_ATTR]: "" }}
        aria-label="メニュー"
        title="メニュー"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ width: 32, height: 32, "@media (pointer: coarse), (max-width: 800px)": { width: 44, height: 44, my: "-6px", mr: "-6px" }, color: "var(--muted)", borderRadius: "var(--radius)", "&:hover, &[aria-expanded=true]": { bgcolor: "var(--bg)", color: "var(--text)" } }}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </IconButton>
      <Menu
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        slotProps={{
          list: { dense: true },
          paper: { sx: { minWidth: 200, bgcolor: "var(--paper)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", backgroundImage: "none" } },
        }}
        // 閉じるときのフォーカスは、押した「…」ボタンに戻る（MUI の既定）。プレゼンモードのときは、閉じたあとに記事のスクリプトが戻す
      >
        {shareable && (
          <MenuItem onClick={onShare} sx={itemSx}>
            <ListItemIcon sx={{ color: "var(--muted)" }}>
              <Share2 size={16} aria-hidden="true" />
            </ListItemIcon>
            <ListItemText>共有</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={onCopy} sx={itemSx}>
          <ListItemIcon sx={{ color: "var(--muted)" }}>
            <Copy size={16} aria-hidden="true" />
          </ListItemIcon>
          <ListItemText>URLをコピー</ListItemText>
        </MenuItem>
        {presentable && (
          <MenuItem
            aria-haspopup="dialog"
            onClick={() => {
              close();
              document.dispatchEvent(new Event(PRESENT_EVENT));
            }}
            sx={itemSx}
          >
            <ListItemIcon sx={{ color: "var(--muted)" }}>
              <Presentation size={16} aria-hidden="true" />
            </ListItemIcon>
            <ListItemText>プレゼンモードで表示</ListItemText>
          </MenuItem>
        )}
      </Menu>
      {/* 結果は、押したメニューが閉じても残るよう、画面の下に短く出す（読み上げにも伝わる） */}
      <Snackbar
        open={notice !== null}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        message={notice}
        slotProps={{ content: { role: "status", sx: { bgcolor: "var(--text)", color: "var(--bg)" } } }}
      />
    </>
  );
}
