import { Search } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { parseSearchQuery, searchTerms, splitByTerms, type SearchResult } from "@wiki/shared";
import { useEffect, useRef, useState } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpTip } from "../components/HelpTip";
import { Mono, Muted, RouterLink, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useComposition, useSearchTerm } from "../lib/searchTerm";
import { pageLink } from "../lib/wiki";
import { visibilityLabel } from "./PagesPage";
import { useScreenTitle } from "../lib/documentTitle";

/**
 * 検索の画面。タイトルと本文を探し、本文に一致したときは前後の文も出す。
 * 検索の語は URL（?q=）に持つので、結果の画面を再読み込み・共有できる。
 */
export function SearchPage(props: { q: string; onChange: (q: string) => void }) {
  useScreenTitle("検索");
  const [input, setInput] = useState(props.q);
  // 戻る・進むで URL が変わったら、入力欄も合わせる
  useEffect(() => setInput(props.q), [props.q]);
  // 打つのを止めてから（変換中は、確定してから）URL に反映する。1文字ごとには探しにいかない
  const { composing, compositionProps } = useComposition();
  const term = useSearchTerm(input, composing);
  useEffect(() => {
    // 戻る・進むで入力欄を合わせた直後は、term がまだ前の語のことがある。入力に追いついた語だけを反映する
    if (term === input && term !== props.q) props.onChange(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const q = props.q.trim();
  const terms = searchTerms(parseSearchQuery(q));
  const search = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q !== "", placeholderData: keepPreviousData });
  const results = q === "" ? undefined : search.data?.results;

  const list = useRef<HTMLDivElement>(null);
  const columns: DataListColumn<SearchResult>[] = [
    {
      key: "title",
      header: "タイトルと一致した文",
      // 一致した前後の文も、タイトルの下に出す。狭い画面でも1文字ずつに潰れない幅を取る
      width: "minmax(220px, 1fr)",
      sx: { alignItems: "flex-start", overflowWrap: "anywhere" },
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <RouterLink {...pageLink(r.id)} sx={{ fontWeight: 600 }}>
            <Highlight text={r.title} terms={terms} />
          </RouterLink>
          {r.snippet && (
            <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
              <Highlight text={r.snippet} terms={terms} />
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: "visibility",
      header: "状態",
      width: "120px",
      sx: { alignItems: "flex-start" },
      render: (r) => <StatusChip status={r.visibility} label={visibilityLabel[r.visibility]} />,
    },
    {
      key: "updatedAt",
      header: "更新日時",
      width: "160px",
      sx: { alignItems: "flex-start", whiteSpace: "nowrap" },
      render: (r) => <Muted component="span">{formatDateTime(r.updatedAt)}</Muted>,
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Typography variant="h5" component="h1">
        検索
      </Typography>
      <TextField
        autoFocus
        fullWidth
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // ↓ で最初の結果へ（変換中の ↓ は、変換の候補を選ぶ操作なので奪わない）
          if (e.key !== "ArrowDown" || e.nativeEvent.isComposing) return;
          const first = list.current?.querySelector<HTMLElement>("[role='table'] a");
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
        placeholder="例：公開 予約"
        slotProps={{
          htmlInput: { "aria-label": "タイトルと本文を検索", "aria-describedby": "search-syntax", ...compositionProps },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Muted id="search-syntax" sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
        タイトルと本文を探します。
        <HelpTip about="検索の書き方">
          空白で区切ると、すべてを含むページ。<Mono>"二つの 語"</Mono> でひと続きの語、<Mono>-語</Mono> で含まないページ、<Mono>A OR B</Mono> でどちらかを含むページを探します。
        </HelpTip>
      </Muted>

      {search.error && <Alert severity="error">{errorMessage(search.error)}</Alert>}
      {results && (
        <Muted role="status" sx={{ overflowWrap: "anywhere" }}>{results.length === 0 ? `「${q}」に一致するページはありません。語を減らすか、別の言い方を試してください。` : `${results.length}件${results.length >= 50 ? "（最初の50件）" : ""}`}</Muted>
      )}
      {q !== "" && (search.isPending || (results && results.length > 0)) && (
        // 結果が確かめられるまで（初回の検索中）は、行の形の Skeleton を出す
        <Section sx={{ p: 0 }}>
          <Box ref={list}>
            <DataList
              label="検索結果"
              columns={columns}
              rows={results}
              rowKey={(r) => r.id}
              rowLink={(r) => pageLink(r.id)}
              empty=""
              skeletonRows={3}
            />
          </Box>
        </Section>
      )}
    </Stack>
  );
}

/** 検索の語に一致した部分を目立たせる（背景の色に加えて、太字にする）。 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {splitByTerms(text, terms).map((part, i) =>
        part.hit ? (
          <Box key={i} component="mark" sx={{ bgcolor: "search.hit", color: "inherit", fontWeight: 700, borderRadius: 0.5, px: "1px" }}>
            {part.text}
          </Box>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
