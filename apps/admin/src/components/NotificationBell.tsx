import { Bell, CircleCheck, CircleX } from "lucide-react";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@wiki/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatShortDateTime } from "../lib/format";
import { bellLabel, notificationKeys, useUnreadNotificationCount } from "../lib/notifications";
import { TOUCH } from "../theme";
import { Tooltip } from "./Tooltip";
import { RouterLink } from "./ui";

const PANEL_ID = "notifications-panel";
/** 1回に読み込む通知の数。残りは「さらに読み込む」で続きを取る */
const PAGE_SIZE = 20;

/** 画面には出さず、読み上げにだけ出す文字 */
const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" } as const;

/**
 * 通知のベル。未読の数をバッジで出し、押すと自分宛ての通知（開いている wiki の分）を新しい順に出す。
 * 1件を押すと既読にして、その画面（ワークフローの詳細など）へ移る。「すべて既読にする」で未読をまとめて消せる。
 * 広い画面ではサイドバーの最上段に、狭い画面では上の帯に置く。
 */
export function NotificationBell({ onNavigate }: { onNavigate?: () => void }) {
  const qc = useQueryClient();
  const unread = useUnreadNotificationCount();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;

  const list = useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => api.listNotifications({ limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: notificationKeys.all() });
  const markRead = useMutation({ mutationFn: (id: string) => api.markNotification(id, true), onSettled: refresh });
  const markAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSettled: refresh });

  const items = list.data?.pages.flatMap((p) => p.notifications) ?? [];
  const label = bellLabel(unread);
  const close = () => setAnchor(null);

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? PANEL_ID : undefined}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            // 開くたびに、最新を取り直す（閉じているあいだは一覧を取らない）
            void refresh();
          }}
          sx={{ [TOUCH]: { width: 40, height: 40 } }}
        >
          <Badge badgeContent={unread} max={99} color="primary" overlap="circular" sx={{ "& .MuiBadge-badge": { fontSize: "0.65rem", height: 16, minWidth: 16, px: 0.5 } }}>
            <Bell size={18} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            id: PANEL_ID,
            role: "dialog",
            "aria-labelledby": `${PANEL_ID}-title`,
            sx: { width: 380, maxWidth: "calc(100vw - 32px)", maxHeight: "min(560px, calc(100vh - 80px))", display: "flex", flexDirection: "column", mt: 0.5 },
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
          <Typography id={`${PANEL_ID}-title`} component="h2" sx={{ flex: 1, fontWeight: 600, fontSize: "0.95rem" }}>
            通知
          </Typography>
          <Button size="small" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
            すべて既読にする
          </Button>
        </Box>
        {(markAll.error || markRead.error) && (
          <Alert severity="error" sx={{ m: 1 }}>
            既読にできませんでした。{errorMessage(markAll.error ?? markRead.error)}
          </Alert>
        )}
        <Box sx={{ overflowY: "auto", minHeight: 0 }}>
          {list.isPending && open && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              読み込んでいます…
            </Typography>
          )}
          {list.error && (
            <Alert severity="error" sx={{ m: 1 }}>
              通知を読み込めませんでした。{errorMessage(list.error)}
            </Alert>
          )}
          {list.isSuccess && items.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                通知はまだありません
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                ワークフローの実行が終わると、ここに知らせが届きます。
              </Typography>
            </Box>
          )}
          {items.length > 0 && (
            <Box component="ul" aria-label="通知の一覧" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onOpen={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    close();
                    onNavigate?.();
                  }}
                />
              ))}
            </Box>
          )}
          {list.hasNextPage && (
            <Box sx={{ p: 1, textAlign: "center" }}>
              <Button size="small" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? "読み込んでいます…" : "さらに読み込む"}
              </Button>
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
}

/** 通知の1行。未読は、左の印・太字・背景の3つで示す（色だけに頼らない）。行のどこを押しても移る */
function NotificationRow({ notification: n, onOpen }: { notification: Notification; onOpen: () => void }) {
  const unread = n.readAt === null;
  const failed = n.kind === "workflow_run_failed";
  const content = (
    <>
      <Box
        component="span"
        aria-hidden
        sx={{ flexShrink: 0, width: 8, height: 8, mt: "7px", borderRadius: "50%", bgcolor: unread ? "primary.main" : "transparent" }}
      />
      <Box component={failed ? CircleX : CircleCheck} aria-hidden size={18} sx={{ flexShrink: 0, mt: "1px", color: failed ? "error.main" : "success.main" }} />
      <Box component="span" sx={{ flex: 1, minWidth: 0, display: "block" }}>
        {unread && <Box component="span" sx={visuallyHidden}>未読：</Box>}
        <Box component="span" sx={{ display: "block", fontWeight: unread ? 600 : 400, color: "text.primary", lineHeight: 1.45, overflowWrap: "anywhere" }}>
          {n.title}
        </Box>
        {n.body && (
          <Box
            component="span"
            sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", color: "text.secondary", fontSize: "0.8rem", lineHeight: 1.5, overflowWrap: "anywhere" }}
          >
            {n.body}
          </Box>
        )}
        <Box component="time" dateTime={n.createdAt} sx={{ display: "block", mt: 0.25, color: "text.secondary", fontSize: "0.75rem" }}>
          {formatShortDateTime(n.createdAt)}
        </Box>
      </Box>
    </>
  );
  const rowSx = {
    display: "flex",
    alignItems: "flex-start",
    gap: 1,
    px: 1.5,
    py: 1.25,
    borderBottom: 1,
    borderColor: "divider",
    bgcolor: unread ? "action.hover" : "transparent",
    fontSize: "0.875rem",
  } as const;
  return (
    <li>
      {n.link ? (
        <RouterLink
          // 移る先は API が作った管理画面のパス（`/w/{key}/...`）
          to={n.link as never}
          underline="none"
          data-unread={unread ? "true" : "false"}
          onClick={onOpen}
          sx={{ ...rowSx, color: "inherit", "&:hover": { bgcolor: "action.selected" }, "&:focus-visible": { outlineOffset: -2 } }}
        >
          {content}
        </RouterLink>
      ) : (
        <Box sx={rowSx}>{content}</Box>
      )}
    </li>
  );
}
