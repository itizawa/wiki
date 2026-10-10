import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import type { PageSummary, PageViewCounts } from "@wiki/shared";
import { useMemo, useState } from "react";
import { StarButton } from "../components/StarButton";
import { Mono, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { workflowLabel } from "../components/WorkflowPanel";
import { api, errorMessage } from "../lib/api";
import { pageLink } from "../lib/wiki";
import { formatDateTime } from "../lib/format";
import { isCounted, measuredSinceLabel, viewCountLabel, viewSortValue, VIEWS_NOTE } from "../lib/views";

const STAR_WIDTH = 36;

/** 横に送っても残す列（スターとタイトル）。どの行かを見失わないようにする。 */
const stickyCell = {
  position: "sticky",
  zIndex: 1,
  bgcolor: "background.paper",
  // 下を通る列が透けないよう地の色で塗るので、行にカーソルを載せたときの色は重ねて出す
  "tr.MuiTableRow-hover:hover > &": {
    backgroundImage: (t: Theme) => `linear-gradient(${t.palette.action.hover}, ${t.palette.action.hover})`,
  },
} as const;
// 幅が足りない表では width だけだと縮むので、minWidth でも押さえる（縮むと、隣の固定列との間が空く）
const starCell = { left: 0, width: STAR_WIDTH, minWidth: STAR_WIDTH } as const;
/** タイトルは長ければ折り返す。狭い画面でも1文字ずつに潰れない幅を取る。 */
const titleCell = { left: STAR_WIDTH, minWidth: 140, maxWidth: { xs: 180, sm: "none" }, whiteSpace: "normal !important", overflowWrap: "anywhere" } as const;

type ViewSort = { key: keyof PageViewCounts; dir: "desc" | "asc" } | null;

const VIEW_COLUMNS = [
  { key: "total", label: "閲覧（合計）" },
  { key: "recent", label: "直近30日" },
] as const;

export function PagesPage() {
  const [q, setQ] = useState("");
  const pages = useQuery({ queryKey: ["pages", q], queryFn: () => api.listPages(q) });
  const views = useQuery({ queryKey: ["views"], queryFn: api.listViews });
  // 閲覧数の列の見出しで並べ替える。初めは多い順、もう一度押すと少ない順、その次は元の並び（更新日時の順）
  const [sort, setSort] = useState<ViewSort>(null);
  const toggleSort = (key: keyof PageViewCounts) =>
    setSort((cur) => (cur?.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null));
  const rows = useMemo(() => {
    const list = pages.data?.pages ?? [];
    if (!sort) return list;
    const value = (p: PageSummary) => viewSortValue(views.data?.pages[p.id], sort.key, isCounted(p));
    const sign = sort.dir === "desc" ? -1 : 1;
    // 同じ数のあいだは元の並びを保つ
    return [...list].sort((a, b) => sign * (value(a) - value(b)));
  }, [pages.data, views.data, sort]);

  return (
    <Stack spacing={1.5}>
      <Section>
        <Row sx={{ mb: 1 }}>
          <Typography variant="h6" component="h2" noWrap sx={{ flex: 1 }}>
            ページ
          </Typography>
          <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" />
        </Row>
        {views.data && (
          <Muted sx={{ mb: 1, fontSize: "0.75rem" }}>
            閲覧数は公開サイトでの数で、{measuredSinceLabel(views.data.since)}。{VIEWS_NOTE}。
          </Muted>
        )}
        {pages.isPending && <Muted>読み込み中…</Muted>}
        {pages.error && <Alert severity="error">{errorMessage(pages.error)}</Alert>}
        {pages.data && pages.data.pages.length === 0 && (
          <Muted>
            {q ? `「${q}」をタイトルに含むページはありません。` : "ページはまだありません。サイドバーの「最上位に新しいページ」（＋）から作れます。"}
          </Muted>
        )}
        {pages.data && pages.data.pages.length > 0 && (
          // 幅が足りないときは、表だけを横に送る（画面ごと横に動かさない）
          <Box sx={{ overflowX: "auto" }}>
            {/* 列を固定すると、既定の border-collapse では罫線が付いてこない */}
            <Table size="small" sx={{ borderCollapse: "separate", "& th, & td": { whiteSpace: "nowrap" } }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="none" sx={[stickyCell, starCell]} />
                  <TableCell sx={[stickyCell, titleCell]}>タイトル</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell>状態</TableCell>
                  {VIEW_COLUMNS.map((c) => (
                    <TableCell key={c.key} align="right" sortDirection={sort?.key === c.key ? sort.dir : false}>
                      <TableSortLabel
                        active={sort?.key === c.key}
                        direction={sort?.key === c.key ? sort.dir : "desc"}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell>更新日時</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell padding="none" sx={[stickyCell, starCell, { pl: 0.5 }]}>
                      <StarButton pageId={p.id} title={p.title} />
                    </TableCell>
                    <TableCell sx={[stickyCell, titleCell]}>
                      <RouterLink {...pageLink(p.id)}>
                        {p.title}
                      </RouterLink>
                    </TableCell>
                    <TableCell>
                      <Muted component="span">
                        <Mono>{p.id}</Mono>
                      </Muted>
                    </TableCell>
                    <TableCell>
                      <Row sx={{ flexWrap: "nowrap" }}>
                        <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
                        {p.workflowState !== "draft" && <StatusChip label={workflowLabel[p.workflowState]} />}
                        {p.origin === "ai_draft" && <StatusChip label="AI下書き" />}
                        {p.reviewRequestedAt && <StatusChip status="unlisted" label="見直し待ち" />}
                      </Row>
                    </TableCell>
                    {VIEW_COLUMNS.map((c) => (
                      <TableCell key={c.key} align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {views.data ? viewCountLabel(views.data.pages[p.id]?.[c.key], isCounted(p)) : "…"}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Muted component="span">{formatDateTime(p.updatedAt)}</Muted>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Section>
    </Stack>
  );
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
