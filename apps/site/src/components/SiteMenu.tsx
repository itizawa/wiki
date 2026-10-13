import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { Ellipsis, Presentation } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { MENU_BUTTON_ATTR, PRESENT_EVENT, PRESENTABLE_ATTR, PRESENTABLE_EVENT } from "../lib/presentable";

const subscribe = (onChange: () => void) => {
  document.addEventListener(PRESENTABLE_EVENT, onChange);
  return () => document.removeEventListener(PRESENTABLE_EVENT, onChange);
};
const isPresentable = () => document.documentElement.hasAttribute(PRESENTABLE_ATTR);

/**
 * ヘッダー右端の「…」メニュー（管理画面のページのメニューと同じ MUI の Menu）。色は、wiki のテーマの CSS 変数から取る。
 * 出す項目が無いページ（スライドにならない記事など）では、ボタンごと出さない。検索と RSS はサイドバー（NavDrawer.astro）
 */
export default function SiteMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const presentable = useSyncExternalStore(subscribe, isPresentable, () => false);
  if (!presentable) return null;
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        {...{ [MENU_BUTTON_ATTR]: "" }}
        aria-label="メニュー"
        title="メニュー"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ width: 32, height: 32, color: "var(--muted)", borderRadius: "var(--radius)", "&:hover, &[aria-expanded=true]": { bgcolor: "var(--bg)", color: "var(--text)" } }}
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
        <MenuItem
          aria-haspopup="dialog"
          onClick={() => {
            close();
            document.dispatchEvent(new Event(PRESENT_EVENT));
          }}
          sx={{ "&:hover, &.Mui-focusVisible": { bgcolor: "var(--bg)" } }}
        >
          <ListItemIcon sx={{ color: "var(--muted)" }}>
            <Presentation size={16} aria-hidden="true" />
          </ListItemIcon>
          <ListItemText>プレゼンモードで表示</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
