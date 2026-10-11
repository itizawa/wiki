import { Search } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { parseSearchQuery, searchTerms, splitByTerms } from "@wiki/shared";
import { useEffect, useState } from "react";
import { LoadingRegion, Mono, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useComposition, useSearchTerm } from "../lib/searchTerm";
import { pageLink } from "../lib/wiki";
import { visibilityLabel } from "./PagesPage";

/**
 * 検索の画面。タイトルと本文を探し、本文に一致したときは前後の文も出す。
 * 検索の語は URL（?q=）に持つので、結果の画面を再読み込み・共有できる。
 */
export function SearchPage(props: { q: string; onChange: (q: string) => void }) {
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
      <Muted id="search-syntax">
        タイトルと本文を探します。空白で区切ると、すべてを含むページ。<Mono>"二つの 語"</Mono> でひと続きの語、<Mono>-語</Mono> で含まないページ、<Mono>A OR B</Mono> でどちらかを含むページ。
      </Muted>

      {search.error && <Alert severity="error">{errorMessage(search.error)}</Alert>}
      {q !== "" && search.isPending && (
        // 件数の行と、結果の行（タイトル + 前後の文）の形
        <LoadingRegion label="検索中">
          <Skeleton variant="text" width={48} sx={{ fontSize: "0.875rem", mb: 1.5 }} />
          <Section sx={{ p: 0 }}>
            {["38%", "52%", "30%"].map((width) => (
              <Box key={width} sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
                <Skeleton variant="text" width={width} />
                <Skeleton variant="text" width="90%" sx={{ fontSize: "0.875rem", mt: 0.5 }} />
              </Box>
            ))}
          </Section>
        </LoadingRegion>
      )}
      {results && (
        <Muted role="status">{results.length === 0 ? `「${q}」に一致するページはありません。語を減らすか、別の言い方を試してください。` : `${results.length}件${results.length >= 50 ? "（最初の50件）" : ""}`}</Muted>
      )}
      {results && results.length > 0 && (
        <Section sx={{ p: 0 }}>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {results.map((r) => (
              <Box component="li" key={r.id} sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
                <Row>
                  <RouterLink {...pageLink(r.id)} sx={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
                    <Highlight text={r.title} terms={terms} />
                  </RouterLink>
                  <StatusChip status={r.visibility} label={visibilityLabel[r.visibility]} />
                  <Muted component="span" sx={{ ml: "auto" }}>
                    {formatDateTime(r.updatedAt)}
                  </Muted>
                </Row>
                {r.snippet && (
                  <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary", overflowWrap: "anywhere" }}>
                    <Highlight text={r.snippet} terms={terms} />
                  </Typography>
                )}
              </Box>
            ))}
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
