import { ChevronDown } from "lucide-react";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import Popover from "@mui/material/Popover";
import type { PageDetail } from "@wiki/shared";
import { useState } from "react";
import { PublishPanel, type EnsureVersion } from "./PublishPanel";

const PANEL_ID = "publish-menu";

/** いまの公開範囲。ヘッダーのボタンと、「…」メニューの「公開・予約」に出す。 */
export function publishState(page: PageDetail): { label: string; color: "success" | "warning" | "inherit" } {
  if (page.publishedVersionId === null || page.visibility === "private") return { label: "非公開", color: "inherit" };
  return page.visibility === "unlisted" ? { label: "限定公開中", color: "warning" } : { label: "公開中", color: "success" };
}

type PanelProps = { page: PageDetail; dirty: boolean; ensureVersion: EnsureVersion };

/** スマホ幅で、公開・予約を下から出すシート。「…」メニューの「公開・予約」から開く。 */
export function PublishSheet({ open, onClose, ...props }: PanelProps & { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { "aria-label": "公開", sx: { maxHeight: "85vh", borderTopLeftRadius: 12, borderTopRightRadius: 12 } } }}
    >
      <PublishPanel {...props} />
    </Drawer>
  );
}

/**
 * 編集画面の右上の「公開」。押すとボタンの下に小さな枠を開き、公開・予約をタブで並べる。スマホ幅ではヘッダーに置かず、「…」メニューから `PublishSheet` を開く。
 * `dirty`（まだ版になっていない変更がある）のあいだは、公開・予約の前に `ensureVersion` でいまの内容を版にする。
 */
export function PublishMenu(props: PanelProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const state = publishState(props.page);
  const open = anchor !== null;

  return (
    <>
      <Button
        variant="outlined"
        color={state.color}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        endIcon={<ChevronDown size={18} />}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
      >
        {state.label}
      </Button>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { id: PANEL_ID, "aria-label": "公開", sx: { width: 400, maxHeight: "calc(100vh - 64px)", mt: 0.5 } } }}
      >
        <PublishPanel {...props} />
      </Popover>
    </>
  );
}
