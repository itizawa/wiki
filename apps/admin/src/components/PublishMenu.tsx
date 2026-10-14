import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import Popover from "@mui/material/Popover";
import type { PageDetail } from "@wiki/shared";
import type { ScheduledAction } from "@wiki/shared";
import { useState } from "react";
import { api } from "../lib/api";
import { formatShortDateTime } from "../lib/format";
import { PublishPanel, type EnsureVersion } from "./PublishPanel";

const PANEL_ID = "publish-menu";

/** 一番近い予約（実行を待っているもの）。無ければ null。 */
export function nextScheduled(actions: readonly ScheduledAction[]): ScheduledAction | null {
  return actions.filter((a) => a.status === "scheduled").sort((a, b) => a.runAt.localeCompare(b.runAt))[0] ?? null;
}

/**
 * いまの公開範囲と、予約。ヘッダーのボタンと、「…」メニューの「公開・予約」に出す。
 * 予約があるときは、直近の1件の日時を添える。非公開のページは「予約中 10/20 10:00」、公開中のページは「公開中・予約中 10/20 10:00」。
 */
export function publishState(page: PageDetail, next: ScheduledAction | null = null): { label: string; color: "success" | "warning" | "info" | "inherit" } {
  const base: { label: string; color: "success" | "warning" | "inherit" } =
    page.publishedVersionId === null || page.visibility === "private"
      ? { label: "非公開", color: "inherit" }
      : page.visibility === "unlisted"
        ? { label: "限定公開中", color: "warning" }
        : { label: "公開中", color: "success" };
  if (!next) return base;
  const reserved = `予約中 ${formatShortDateTime(next.runAt)}`;
  return base.label === "非公開" ? { label: reserved, color: "info" } : { label: `${base.label}・${reserved}`, color: base.color };
}

/** `publishState` に、このページの予約（公開の枠と同じ取得）を合わせたもの。 */
export function usePublishState(page: PageDetail) {
  const schedule = useQuery({ queryKey: ["schedule", page.id], queryFn: () => api.listSchedule({ pageId: page.id }) });
  return publishState(page, nextScheduled(schedule.data?.actions ?? []));
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
 * スマホ幅の上の帯の右端に置く、公開の状態のバッジ（「公開中」「限定公開中」「非公開」＋予約の日時）。「…」を開かなくても状態が見える。
 * 押すと `PublishSheet` を開く。長いときは、帯の中で省略して他を押し出さない（全文は読み上げ用の名前と、押して開く枠に出る）。
 */
export function PublishBadge(props: PanelProps) {
  const [open, setOpen] = useState(false);
  const state = usePublishState(props.page);
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color={state.color}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`公開の状態：${state.label}`}
        onClick={() => setOpen(true)}
        sx={{ flexShrink: 1, minWidth: 0, minHeight: 32, px: 1, fontSize: "0.8125rem", whiteSpace: "nowrap" }}
      >
        {/* 「公開中・予約中 10/20 10:00」は、日時が切れないよう「・」で2行に分ける */}
        <Box component="span" sx={{ display: "flex", flexDirection: "column", lineHeight: 1.2, overflow: "hidden" }}>
          {state.label.split("・").map((part) => (
            <Box key={part} component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {part}
            </Box>
          ))}
        </Box>
      </Button>
      <PublishSheet {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * 編集画面の右上の「公開」。押すとボタンの下に小さな枠を開き、公開・予約をタブで並べる。スマホ幅ではヘッダーに置かず、「…」メニューから `PublishSheet` を開く。
 * `dirty`（まだ版になっていない変更がある）のあいだは、公開・予約の前に `ensureVersion` でいまの内容を版にする。
 */
export function PublishMenu(props: PanelProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const state = usePublishState(props.page);
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
