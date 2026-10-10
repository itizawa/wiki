import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { PageViews as PageViewsData } from "@wiki/shared";
import { api, errorMessage } from "../lib/api";
import { DailyBars } from "./DailyBars";
import { measuredSinceLabel, viewCountLabel, VIEWS_NOTE } from "../lib/views";
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
        <DailyBars days={data.days} title="直近30日の日別" ariaLabel="直近30日の日別の閲覧数" unit="回" valueLabel="閲覧" />
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
