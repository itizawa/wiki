import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcceptEditRequestResult, EditRequest, EditRequestItem } from "@wiki/shared";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { EditRequestItemCard, requesterLabel, type ItemNotice } from "../components/EditRequestItemCard";
import { ReviewBody, type ReviewSlot } from "../components/ReviewBody";
import { LoadingRegion, Muted, RouterLink, Section, SkeletonLines } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { invalidateEditRequests, editRequestKeys, placeOfAccepted } from "../lib/editRequests";
import { formatDateTime } from "../lib/format";
import { pageLink } from "../lib/wiki";
import { TOUCH } from "../theme";

type Decision = { kind: "accept" | "reject" | "reopen"; itemId: string } | { kind: "acceptAll"; requestId: string };
type Range = { startLine: number; endLine: number };

/** 「すべて採用」の結果。押したボタンのそばに出す */
type AllResult = { applied: number; skipped: number };

/**
 * `/w/{key}/pages/{id}/requests`：ページの編集リクエストのレビュー画面。
 * 最新の版の本文を読み取り専用で出し、提案を、指している箇所のすぐ下に並べる。ここで1件ずつ（かリクエストごとにまとめて）採用・却下する。
 * 採用すると、その箇所を置き換えた新しい版ができる（公開はしない）。本文は書き換えられない。
 */
export function EditRequestsPage({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  const list = useQuery({ queryKey: editRequestKeys.list(pageId), queryFn: () => api.listEditRequests(pageId) });

  /** 項目の場所に出す、操作の結果 */
  const [notices, setNotices] = useState<Record<string, ItemNotice>>({});
  /** この画面を開いてから採否を決めた項目。結果を、その項目の場所に出し続ける（採用した項目は、API が返した新しい行の範囲も持つ） */
  const [recent, setRecent] = useState<Record<string, Range | true>>({});
  const [allResults, setAllResults] = useState<Record<string, AllResult>>({});

  const noteAccepted = (result: AcceptEditRequestResult) => {
    setRecent((r) => ({ ...r, ...Object.fromEntries(result.applied.map((a) => [a.itemId, { startLine: a.startLine, endLine: a.endLine }])) }));
    setNotices((n) => {
      const next = { ...n };
      for (const a of result.applied) delete next[a.itemId];
      for (const s of result.skipped) {
        // 古くなった項目は、読み直した一覧が理由を出す
        if (s.reason === "draft_conflict") next[s.itemId] = { kind: "draft_conflict", editors: s.editors ?? [] };
        else if (s.reason === "overlap") next[s.itemId] = { kind: "overlap" };
      }
      return next;
    });
    if (result.versionId === null) return;
    // 版が増えた：編集画面の本文と下書き、版やタイトルを出している所を読み直す。
    // ツリー（structure）はページの更新日時を持ち、30 秒は取り直さない（lib/queryStaleTime.ts）ので、ここで読み直す（編集画面で版を作ったときと同じ）
    for (const key of [["page", pageId], ["draft", pageId], ["versions", pageId], ["pages"], ["search"], ["structure"], ["schedule"]]) void qc.invalidateQueries({ queryKey: key });
  };

  const decide = useMutation({
    mutationFn: async (d: Decision) => {
      if (d.kind === "accept") return api.acceptEditRequestItem(pageId, d.itemId);
      if (d.kind === "acceptAll") return api.acceptAllEditRequestItems(pageId, d.requestId);
      if (d.kind === "reject") await api.rejectEditRequestItem(pageId, d.itemId);
      else await api.reopenEditRequestItem(pageId, d.itemId);
      return null;
    },
    onSuccess: (result, d) => {
      if (result) noteAccepted(result);
      if (d.kind === "acceptAll" && result) setAllResults((r) => ({ ...r, [d.requestId]: { applied: result.applied.length, skipped: result.skipped.length } }));
      if (d.kind === "reject") setRecent((r) => ({ ...r, [d.itemId]: true }));
      if (d.kind === "reject" || d.kind === "reopen") {
        setNotices(({ [d.itemId]: _, ...rest }) => rest);
      }
    },
    onError: (err, d) => {
      if (d.kind === "acceptAll") return;
      const details = err instanceof ApiError ? (err.details as { editors?: { id: string; name: string }[] } | undefined) : undefined;
      // 古くなった項目は、読み直した一覧が理由を出すので、ここでは重ねて出さない
      if (err instanceof ApiError && err.code === "edit_request_stale") setNotices(({ [d.itemId]: _, ...rest }) => rest);
      else if (err instanceof ApiError && err.code === "draft_conflict") setNotices((n) => ({ ...n, [d.itemId]: { kind: "draft_conflict", editors: details?.editors ?? [] } }));
      else setNotices((n) => ({ ...n, [d.itemId]: { kind: "error", message: errorMessage(err) } }));
    },
    // 成功しても失敗しても、項目の状態と「古くなった」を読み直す。読み直しが終わるまで、次の操作は待たせる
    onSettled: () => invalidateEditRequests(qc, pageId),
  });
  const pending = decide.isPending ? decide.variables : null;
  const busyOf = (itemId: string) => (pending && pending.kind !== "acceptAll" && pending.itemId === itemId ? pending.kind : null);

  const data = list.data;
  const view = useMemo(() => {
    if (!data) return null;
    const head = { versionId: data.headVersionId, bodyMd: data.headBodyMd };
    const inline: { request: EditRequest; item: EditRequestItem; range: Range; highlight: boolean }[] = [];
    const unplaced: { request: EditRequest; item: EditRequestItem }[] = [];
    const done: { request: EditRequest; item: EditRequestItem }[] = [];
    for (const request of data.requests) {
      for (const item of request.items) {
        const known = recent[item.id];
        if (item.status === "open") {
          if (item.current) inline.push({ request, item, range: item.current, highlight: true });
          else unplaced.push({ request, item });
        } else if (known === undefined) {
          done.push({ request, item });
        } else {
          // この画面で決めた項目は、結果をその場所に出す
          const range = item.status === "accepted" ? placeOfAccepted(item, head, known === true ? undefined : known) : item.current;
          if (range) inline.push({ request, item, range, highlight: false });
          else unplaced.push({ request, item });
        }
      }
    }
    return { inline, unplaced, done, pendingRequests: data.requests.filter((r) => r.items.some((i) => i.status === "open")) };
  }, [data, recent]);

  const card = (request: EditRequest, item: EditRequestItem) => (
    <EditRequestItemCard
      pageId={pageId}
      request={request}
      item={item}
      notice={notices[item.id]}
      busy={busyOf(item.id)}
      disabled={decide.isPending}
      onAccept={() => decide.mutate({ kind: "accept", itemId: item.id })}
      onReject={() => decide.mutate({ kind: "reject", itemId: item.id })}
      onReopen={() => decide.mutate({ kind: "reopen", itemId: item.id })}
    />
  );
  // 本文に差し込むもの。項目・操作の途中の状態（通信中・結果）が変わったときだけ作り直す（作り直すと、本文を描き直す）
  const slots = useMemo(
    (): ReviewSlot[] =>
      (view?.inline ?? []).map(({ request, item, range, highlight }) => ({
        key: item.id,
        startLine: range.startLine,
        endLine: range.endLine,
        highlight,
        content: card(request, item),
      })),
    // card は、下の値だけから決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, notices, decide.isPending, decide.variables, pageId],
  );

  const title = page.data?.title ?? "";
  const openCount = data?.openCount;
  const loadError = list.error ?? page.error;

  return (
    <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          minHeight: 48,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: 2,
          rowGap: 0.5,
          px: 2,
          py: 0.75,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <RouterLink {...pageLink(pageId)} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, py: 0.5, [TOUCH]: { py: 1 } }}>
          <ArrowLeft size={16} aria-hidden />
          編集画面に戻る
        </RouterLink>
        <Typography component="h1" variant="subtitle1" sx={{ fontWeight: 700 }}>
          編集リクエスト
        </Typography>
        {openCount !== undefined && (
          <Chip size="small" variant={openCount > 0 ? "filled" : "outlined"} color={openCount > 0 ? "primary" : "default"} label={`未対応 ${openCount} 件`} sx={{ ml: "auto" }} />
        )}
      </Box>

      <Box sx={{ width: "100%", maxWidth: 780 + 64, mx: "auto", px: { xs: 2, md: 4 }, pt: 3, pb: 12 }}>
        {loadError ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                onClick={() => {
                  void list.refetch();
                  void page.refetch();
                }}
                sx={{ whiteSpace: "nowrap" }}
              >
                もう一度読み込む
              </Button>
            }
          >
            編集リクエストを読み込めませんでした。{errorMessage(loadError)}
          </Alert>
        ) : !data || !view || !page.data ? (
          <LoadingRegion label="編集リクエストを読み込み中">
            <Skeleton variant="text" width="60%" sx={{ fontSize: "2.25rem", lineHeight: 1.25 }} />
            <Skeleton variant="rounded" height={96} sx={{ my: 2 }} />
            <SkeletonLines lines={5} />
          </LoadingRegion>
        ) : (
          <Stack spacing={3}>
            <Muted>
              最新の版の本文に、提案を、指している箇所のすぐ下に出しています。採用すると、その箇所を置き換えた新しい版ができます。公開中の内容は、公開し直すまで変わりません。
            </Muted>

            {data.requests.length === 0 ? (
              <Section>
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  このページへの編集リクエストは、まだありません
                </Typography>
                <Muted sx={{ mt: 0.5 }}>
                  編集リクエストは、本文の箇所ごとに「こう直す」を提案してもらい、1件ずつ採用・却下を決める仕組みです。いまは、外部のアプリ（MCP）でつないだ AI
                  が出せます。出されると、下の本文の、指している箇所のすぐ下に並びます。
                </Muted>
                <Box sx={{ mt: 1 }}>
                  <RouterLink to="/connections">外部のアプリのつなぎ方を見る</RouterLink>
                </Box>
              </Section>
            ) : (
              view.pendingRequests.length === 0 && <Alert severity="success">未対応の提案はありません。これまでの提案は、いちばん下の「対応済みの提案」にあります。</Alert>
            )}

            {view.pendingRequests.length > 0 && (
              <Stack component="section" aria-label="未対応のリクエスト" spacing={1.5}>
                {view.pendingRequests.map((request) => (
                  <RequestSummary
                    key={request.id}
                    request={request}
                    result={allResults[request.id]}
                    error={decide.isError && decide.variables?.kind === "acceptAll" && decide.variables.requestId === request.id ? decide.error : null}
                    busy={pending?.kind === "acceptAll" && pending.requestId === request.id}
                    disabled={decide.isPending}
                    onAcceptAll={() => decide.mutate({ kind: "acceptAll", requestId: request.id })}
                  />
                ))}
              </Stack>
            )}

            {view.unplaced.length > 0 && (
              <Stack component="section" spacing={1} aria-labelledby="unplaced-title">
                <Typography id="unplaced-title" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  本文の中に場所が見つからない提案
                </Typography>
                <Muted>提案のあとに本文が書き換えられ、どこを指していたかを示せないものです。</Muted>
                {view.unplaced.map(({ request, item }) => (
                  <Box key={item.id}>{card(request, item)}</Box>
                ))}
              </Stack>
            )}

            <Box component="article" aria-label="最新の版の本文">
              {/* 編集画面のタイトルと同じ見た目 */}
              <Typography component="h2" sx={{ fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25, mb: 1, overflowWrap: "anywhere" }}>
                {page.data.icon && (
                  <Box component="span" sx={{ mr: 1 }}>
                    {page.data.icon}
                  </Box>
                )}
                {title || "無題"}
              </Typography>
              {data.headBodyMd.trim() === "" && <Muted>本文は、まだ書かれていません。</Muted>}
              <ReviewBody bodyMd={data.headBodyMd} slots={slots} />
            </Box>

            {view.done.length > 0 && (
              <Accordion variant="outlined" disableGutters slotProps={{ transition: { unmountOnExit: true } }} sx={{ "&::before": { display: "none" }, borderRadius: 1 }}>
                <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ [TOUCH]: { minHeight: 48 } }}>
                  <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
                    対応済みの提案（{view.done.length} 件）
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1}>
                    <Muted>採用・却下・取り下げが済んだ提案です。却下した提案は、未対応に戻せます。</Muted>
                    {view.done.map(({ request, item }) => (
                      <Box key={item.id}>{card(request, item)}</Box>
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

/** リクエスト1件のまとめ：出した人・日時・全体へのひとこと・未対応の件数と、「すべて採用する」。 */
function RequestSummary(props: {
  request: EditRequest;
  result: AllResult | undefined;
  error: unknown;
  busy: boolean;
  disabled: boolean;
  onAcceptAll: () => void;
}) {
  const { request, result } = props;
  const open = request.items.filter((i) => i.status === "open");
  const acceptable = open.filter((i) => i.stale === null).length;
  const stale = open.length - acceptable;
  return (
    <Section sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 1 }}>
        <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {requesterLabel(request)} のリクエスト
        </Typography>
        <Muted component="span">{formatDateTime(request.createdAt)}</Muted>
      </Box>
      {request.comment && (
        <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: "divider", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.comment}</Box>
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
        <Muted component="span">
          未対応 {open.length} 件{stale > 0 && `（うち ${stale} 件は古くなっていて、採用できません）`}
        </Muted>
        {/* 何件をまとめて採用するのかを、押す前に分かるようにする。採用できるものが無ければ出さない（理由は、すぐ左に出している） */}
        {acceptable > 0 && (
          <Button variant="outlined" size="small" disabled={props.disabled} loading={props.busy} onClick={props.onAcceptAll} sx={{ ml: { sm: "auto" }, [TOUCH]: { minHeight: 40 } }}>
            採用できる {acceptable} 件をすべて採用する
          </Button>
        )}
      </Box>
      {props.error ? (
        <Alert severity="error">まとめて採用できませんでした。{errorMessage(props.error)}</Alert>
      ) : (
        result && (
          <Alert severity={result.skipped > 0 ? "warning" : "success"}>
            {result.applied > 0 ? `${result.applied} 件を採用し、新しい版を1つ作りました。` : "採用できる提案がありませんでした。"}
            {result.skipped > 0 && `${result.skipped} 件は採用できませんでした。理由は、それぞれの提案に出しています。`}
          </Alert>
        )
      )}
    </Section>
  );
}
