import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { formatDay } from "../lib/format";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

const CHART_HEIGHT = 64;

/**
 * 日別の棒グラフ（「アクセス解析」で使う）。棒に触れると日付と数が出る。数値の表も開ける。
 * `title`：グラフの上に出す名前（「直近30日の日別」）。`unit`：数のあとに付ける語（「回」）。`valueLabel`：表の数の列の見出し。
 */
export function DailyBars(props: { days: { day: string; count: number }[]; title: string; ariaLabel: string; unit: string; valueLabel: string; height?: number }) {
  const { days, unit } = props;
  const peak = Math.max(0, ...days.map((d) => d.count));
  // 棒の高さの基準。すべて 0 の日でも割れるよう、1 を下限にする
  const max = Math.max(1, peak);
  const year = new Date().getFullYear();
  const first = days[0];
  const last = days.at(-1);
  const value = (count: number) => `${count.toLocaleString("ja-JP")}${unit}`;
  return (
    <div>
      <Muted sx={{ fontSize: "0.75rem", mb: 0.5 }}>
        {props.title}（いちばん多い日 {value(peak)}）
      </Muted>
      <Box
        role="img"
        aria-label={`${props.ariaLabel}。数値は下の「日別の数」で読めます`}
        // 日数が多いとき（90日）は、狭い画面でも棒が消えないよう、すき間を詰める
        sx={{ display: "flex", alignItems: "flex-end", gap: days.length > 45 ? "1px" : "2px", height: props.height ?? CHART_HEIGHT, borderBottom: 1, borderColor: "divider" }}
      >
        {days.map((d) => (
          <Tooltip key={d.day} title={`${formatDay(d.day, year)} ${value(d.count)}`}>
            {/* 触れる範囲は棒より大きく（列の高さいっぱい）取る */}
            <Box sx={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
              <Box
                sx={{
                  width: "100%",
                  height: d.count === 0 ? 0 : `max(2px, ${(d.count / max) * 100}%)`,
                  bgcolor: "primary.main",
                  borderRadius: days.length > 45 ? "2px 2px 0 0" : "4px 4px 0 0",
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
                <TableCell align="right">{props.valueLabel}</TableCell>
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
