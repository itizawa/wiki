import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { PageViews as PageViewsData } from "@wiki/shared";
import { api, errorMessage } from "../lib/api";
import { formatDay } from "../lib/format";
import { measuredSinceLabel, viewCountLabel, VIEWS_NOTE } from "../lib/views";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

/**
 * 記事の「閲覧数」。編集画面の「…」メニューに合計を出し、押すと直近30日の数と日別の推移を開く。
 * 数えていない（公開していない）記事は「—」。
 */
export function usePageViews(pageId: string, counted: boolean) {
  const views = useQuery({ queryKey: ["views", pageId], queryFn: () => api.pageViews(pageId) });
  const total = views.data && (views.data.total > 0 || counted) ? views.data.total : undefined;
  /** 「171回」「—」。読み込み中は「…」 */
  const totalLabel = views.data ? `${viewCountLabel(total, counted)}${total !== undefined ? "回" : ""}` : "…";
  return { views, totalLabel };
}

/** 「閲覧数」を押して開く中身。`anchorEl` の下に出す */
export function PageViewsPopover(props: { views: ReturnType<typeof usePageViews>["views"]; counted: boolean; anchorEl: HTMLElement | null; open: boolean; onClose: () => void }) {
  const { views } = props;
  return (
    <Popover
      open={props.open}
      anchorEl={props.anchorEl}
      onClose={props.onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { "aria-label": "閲覧数", sx: { width: 360, maxWidth: "calc(100vw - 32px)", p: 2, mt: 0.5 } } }}
    >
      {views.error && <Muted color="error">{errorMessage(views.error)}</Muted>}
      {views.data && <PageViewsPanel data={views.data} counted={props.counted} />}
    </Popover>
  );
}

function PageViewsPanel({ data, counted }: { data: PageViewsData; counted: boolean }) {
  const hasCount = data.total > 0 || counted;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", gap: 3 }}>
        <Figure label="合計" value={viewCountLabel(hasCount ? data.total : undefined, counted)} />
        <Figure label="直近30日" value={viewCountLabel(hasCount ? data.recent : undefined, counted)} />
      </Box>
      {hasCount ? (
        <DailyBars days={data.days} />
      ) : (
        <Muted>公開（限定公開を除く）している記事だけを数えます。公開すると数え始めます。</Muted>
      )}
      <Muted sx={{ fontSize: "0.75rem" }}>
        {measuredSinceLabel(data.since)}。{VIEWS_NOTE}（同じブラウザの同じ日の閲覧は1回と数えます）
      </Muted>
    </Box>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Muted sx={{ fontSize: "0.75rem" }}>{label}</Muted>
      <Typography sx={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </div>
  );
}

const CHART_HEIGHT = 64;

/** 直近30日の日別の棒グラフ。棒に触れると日付と数が出る。数値の表も開ける */
function DailyBars({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const year = new Date().getFullYear();
  const first = days[0];
  const last = days.at(-1);
  return (
    <div>
      <Muted sx={{ fontSize: "0.75rem", mb: 0.5 }}>直近30日の日別（いちばん多い日 {max.toLocaleString("ja-JP")}回）</Muted>
      <Box
        role="img"
        aria-label="直近30日の日別の閲覧数。数値は下の「日別の数」で読めます"
        sx={{ display: "flex", alignItems: "flex-end", gap: "2px", height: CHART_HEIGHT, borderBottom: 1, borderColor: "divider" }}
      >
        {days.map((d) => (
          <Tooltip key={d.day} title={`${formatDay(d.day, year)} ${d.count.toLocaleString("ja-JP")}回`}>
            {/* 触れる範囲は棒より大きく（列の高さいっぱい）取る */}
            <Box sx={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
              <Box
                sx={{
                  width: "100%",
                  height: d.count === 0 ? 0 : `max(2px, ${(d.count / max) * 100}%)`,
                  bgcolor: "primary.main",
                  borderRadius: "4px 4px 0 0",
                }}
              />
            </Box>
          </Tooltip>
        ))}
      </Box>
      {first && last && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.25 }}>
          <Muted sx={{ fontSize: "0.7rem" }}>{formatDay(first.day, year)}</Muted>
          <Muted sx={{ fontSize: "0.7rem" }}>{formatDay(last.day, year)}</Muted>
        </Box>
      )}
      <Box component="details" sx={{ mt: 1, "& summary": { cursor: "pointer", color: "text.secondary", fontSize: "0.8125rem" } }}>
        <summary>日別の数</summary>
        <Box sx={{ maxHeight: 200, overflowY: "auto", mt: 0.5 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>日付</TableCell>
                <TableCell align="right">閲覧</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...days].reverse().map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{formatDay(d.day, year)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {d.count.toLocaleString("ja-JP")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </div>
  );
}
