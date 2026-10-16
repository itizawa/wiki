import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  HOME_BLOCKS_MAX,
  HOME_GRID_COLUMNS,
  HOME_GRID_MAX_ROWS,
  HOME_LATEST_LIMIT_MAX,
  type HomeBlock,
  sortHomeBlocks,
} from "@wiki/shared";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { addHomeBlock, changeHomeBlock, HOME_BLOCK_LABELS, lastUsedRow, pixelsToCells, removeHomeBlock } from "../lib/homeGrid";
import { Muted, Row } from "./ui";

/** 編集画面のマス目の 1 行の高さ（px）。ブロックの高さは行の数で決める（公開サイトでは中身の高さに合わせて伸びる） */
const ROW_PX = 52;
const GAP_PX = 6;

type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; origin: HomeBlock; base: HomeBlock[] };

/**
 * トップページのグリッドの編集。12 列のマス目にブロックを置く。
 * - ドラッグ：ブロックをつかんで動かす。右下の角をつかんで大きさを変える（マスに吸着する。重なる・はみ出す位置には動かない）
 * - キーボード：マス目のブロックに Tab で入り、矢印で動かし、Shift + 矢印で大きさを変える。下の一覧の数値入力でも変えられる
 * 変えた内容は `onChange` で親に渡す（保存は親）。
 */
export function HomeGridEditor({ blocks, onChange }: { blocks: HomeBlock[]; onChange: (next: HomeBlock[]) => void }) {
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");

  const rows = Math.min(HOME_GRID_MAX_ROWS, Math.max(4, lastUsedRow(blocks) + 1));
  const ordered = sortHomeBlocks(blocks);

  const apply = (id: string, patch: Parameters<typeof changeHomeBlock>[2], from: HomeBlock[] = blocks) => {
    const res = changeHomeBlock(from, id, patch);
    if (res.error) {
      setProblem(res.error);
      setNotice("");
      return false;
    }
    setProblem("");
    onChange(res.blocks);
    return true;
  };

  const describe = (b: HomeBlock) => `列 ${b.col}、行 ${b.row}、幅 ${b.colSpan} 列、高さ ${b.rowSpan} 行`;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, b: HomeBlock) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || e.target !== e.currentTarget) return;
    e.preventDefault();
    const patch = e.shiftKey ? { colSpan: b.colSpan + d[0]!, rowSpan: b.rowSpan + d[1]! } : { col: b.col + d[0]!, row: b.row + d[1]! };
    const res = changeHomeBlock(blocks, b.id, patch);
    if (res.error) {
      setProblem(res.error);
      setNotice("");
      return;
    }
    setProblem("");
    onChange(res.blocks);
    setNotice(`「${HOME_BLOCK_LABELS[b.kind]}」を${e.shiftKey ? "変えました" : "動かしました"}。${describe(res.blocks.find((x) => x.id === b.id)!)}`);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, b: HomeBlock, mode: Drag["mode"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: b.id, mode, startX: e.clientX, startY: e.clientY, origin: b, base: blocks };
    setSelected(b.id);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const box = canvas.current;
    if (!d || !box) return;
    const cellW = (box.getBoundingClientRect().width + GAP_PX) / HOME_GRID_COLUMNS;
    const dc = pixelsToCells(e.clientX - d.startX, cellW);
    const dr = pixelsToCells(e.clientY - d.startY, ROW_PX + GAP_PX);
    const patch = d.mode === "move" ? { col: d.origin.col + dc, row: d.origin.row + dr } : { colSpan: d.origin.colSpan + dc, rowSpan: d.origin.rowSpan + dr };
    // 置けない位置のあいだは、最後に置けた位置のまま。理由は下に出す
    apply(d.id, patch, d.base);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const add = (kind: HomeBlock["kind"]) => {
    const res = addHomeBlock(blocks, kind);
    if (res.error) {
      setProblem(res.error);
      return;
    }
    setProblem("");
    setSelected(res.addedId);
    setNotice(`「${HOME_BLOCK_LABELS[kind]}」を一番下に足しました`);
    onChange(res.blocks);
  };

  const hasIntro = blocks.some((b) => b.kind === "intro");

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="body2" sx={{ mb: 1 }}>
          ブロックをつかんで動かし、右下の角で大きさを変えます。キーボードでは、ブロックに Tab で入り、矢印キーで動かし、Shift + 矢印キーで大きさを変えます。
        </Typography>
        <Box
          ref={canvas}
          role="group"
          aria-label={`トップページのグリッド（${HOME_GRID_COLUMNS} 列）`}
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${HOME_GRID_COLUMNS}, minmax(0, 1fr))`,
            gridAutoRows: ROW_PX,
            gap: `${GAP_PX}px`,
            p: `${GAP_PX}px`,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
            position: "relative",
          }}
        >
          {/* マス目（背景）。ブロックの下に敷く */}
          {Array.from({ length: rows * HOME_GRID_COLUMNS }, (_, i) => (
            <Box
              key={i}
              aria-hidden
              sx={{ gridColumn: (i % HOME_GRID_COLUMNS) + 1, gridRow: Math.floor(i / HOME_GRID_COLUMNS) + 1, border: "1px dashed", borderColor: "divider", borderRadius: 0.5 }}
            />
          ))}
          {ordered.map((b) => (
            <Box
              key={b.id}
              role="group"
              tabIndex={0}
              aria-label={`${HOME_BLOCK_LABELS[b.kind]}のブロック。${describe(b)}`}
              onKeyDown={(e) => onKeyDown(e, b)}
              onFocus={() => setSelected(b.id)}
              onPointerDown={(e) => onPointerDown(e, b, "move")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              sx={{
                gridColumn: `${b.col} / span ${b.colSpan}`,
                gridRow: `${b.row} / span ${b.rowSpan}`,
                position: "relative",
                zIndex: 1,
                p: 1,
                minWidth: 0,
                border: 2,
                borderColor: selected === b.id ? "primary.main" : "text.secondary",
                borderRadius: 1,
                bgcolor: "background.paper",
                cursor: "grab",
                touchAction: "none",
                userSelect: "none",
                overflow: "hidden",
                "&:active": { cursor: "grabbing" },
              }}
            >
              <Typography variant="subtitle2" component="div" noWrap>
                {HOME_BLOCK_LABELS[b.kind]}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {b.colSpan} 列 × {b.rowSpan} 行{b.kind === "latest" ? `・${b.limit ? `${b.limit} 件` : "全件"}` : ""}
              </Typography>
              <Box
                onPointerDown={(e) => onPointerDown(e, b, "resize")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                aria-hidden
                sx={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  width: 22,
                  height: 22,
                  cursor: "nwse-resize",
                  borderTopLeftRadius: 4,
                  bgcolor: selected === b.id ? "primary.main" : "text.secondary",
                  clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
                }}
              />
            </Box>
          ))}
        </Box>
        <Box role={problem ? "alert" : "status"} aria-live="polite" sx={{ minHeight: 24, mt: 0.5, fontSize: "0.85rem", color: problem ? "error.main" : "text.secondary" }}>
          {problem || notice}
        </Box>
      </Box>

      <Row>
        <Button variant="outlined" disabled={hasIntro || blocks.length >= HOME_BLOCKS_MAX} onClick={() => add("intro")}>
          自由記述を足す
        </Button>
        <Button variant="outlined" disabled={blocks.length >= HOME_BLOCKS_MAX} onClick={() => add("latest")}>
          新着記事を足す
        </Button>
        <Muted>
          {blocks.length} / {HOME_BLOCKS_MAX} 個
        </Muted>
      </Row>

      <Box component="ul" aria-label="ブロックの一覧" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {ordered.map((b, i) => (
          <Box
            key={b.id}
            component="li"
            sx={{ p: 1.5, border: 1, borderColor: selected === b.id ? "primary.main" : "divider", borderRadius: 1 }}
          >
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle2" sx={{ minWidth: 96 }}>
                {i + 1}. {HOME_BLOCK_LABELS[b.kind]}
              </Typography>
              <NumberField label="列" value={b.col} min={1} max={HOME_GRID_COLUMNS} onCommit={(v) => apply(b.id, { col: v as number })} />
              <NumberField label="行" value={b.row} min={1} max={HOME_GRID_MAX_ROWS} onCommit={(v) => apply(b.id, { row: v as number })} />
              <NumberField label="幅（列）" value={b.colSpan} min={1} max={HOME_GRID_COLUMNS} onCommit={(v) => apply(b.id, { colSpan: v as number })} />
              <NumberField label="高さ（行）" value={b.rowSpan} min={1} max={HOME_GRID_MAX_ROWS} onCommit={(v) => apply(b.id, { rowSpan: v as number })} />
              {b.kind === "latest" && (
                <NumberField
                  label="件数（空で全件）"
                  value={b.limit}
                  min={1}
                  max={HOME_LATEST_LIMIT_MAX}
                  wide
                  onCommit={(v) => apply(b.id, { limit: v })}
                />
              )}
              <Button
                size="small"
                color="error"
                sx={{ ml: "auto" }}
                aria-label={`「${HOME_BLOCK_LABELS[b.kind]}」を外す`}
                onClick={() => {
                  onChange(removeHomeBlock(blocks, b.id));
                  setProblem("");
                  setNotice(`「${HOME_BLOCK_LABELS[b.kind]}」を外しました。保存するまで公開サイトは変わりません`);
                }}
              >
                外す
              </Button>
            </Stack>
          </Box>
        ))}
      </Box>
      <Muted>スマホなど狭い画面では、この一覧の順（上の行から、同じ行は左から）に 1 列で積んで出します。</Muted>
    </Stack>
  );
}

/**
 * 整数の入力。入力中は何も変えず、入力を終えたとき（フォーカスが外れる・Enter）に値を渡す。
 * 受け付けなかったときは、いまの値に戻す。`value` が null の項目は空で「なし」を表す（空にして確定すると null）
 */
function NumberField({
  label,
  value,
  min,
  max,
  wide,
  onCommit,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  wide?: boolean;
  onCommit: (v: number | null) => boolean;
}) {
  const commit = (input: HTMLInputElement) => {
    const raw = input.value.trim();
    const parsed = raw === "" ? null : Number(raw);
    if (parsed === value) return;
    const ok = onCommit(parsed);
    if (!ok) input.value = value === null ? "" : String(value);
  };
  return (
    <TextField
      key={value ?? "none"}
      label={label}
      type="number"
      size="small"
      defaultValue={value ?? ""}
      onBlur={(e) => commit(e.target as HTMLInputElement)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.target as HTMLInputElement);
      }}
      slotProps={{ htmlInput: { min, max, step: 1, inputMode: "numeric" } }}
      sx={{ width: wide ? 180 : 96 }}
    />
  );
}
