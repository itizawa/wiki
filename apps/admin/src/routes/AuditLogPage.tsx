import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  describeAudit,
  formatAuditTime,
  type AuditCategory,
  type AuditLogEntry,
} from "@wiki/shared";
import { useState } from "react";
import { HelpHeading } from "../components/HelpTip";
import { Field, Muted, RouterLink, Row, Section } from "../components/ui";
import { api, errorMessage, type AuditLogFilter, type AuditScope } from "../lib/api";
import { formatDay } from "../lib/format";
import { monoFont } from "../theme";
import { useWikis } from "./Layout";

const GLOBAL = "global";

/** 「すべて」を選んでいるときも、ラベルを上に出して選んでいるものを見せる */
const selectSlots = { select: { displayEmpty: true } } as const;

/**
 * 監査ログ：重要な操作を「いつ・誰が・何をした」の文で、新しい順に出す。
 * scope が wiki なら開いている wiki のもの（管理者）、all ならすべての wiki と全体にかかわるもの（オーナー）。
 */
export function AuditLogPage({ scope }: { scope: AuditScope }) {
  const [filter, setFilter] = useState<AuditLogFilter>({});
  const logs = useInfiniteQuery({
    queryKey: ["audit-logs", scope, filter],
    queryFn: ({ pageParam }) => api.listAuditLogs(scope, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = logs.data?.pages.flatMap((p) => p.entries) ?? [];
  const filtered = Object.values(filter).some(Boolean);

  return (
    <Stack spacing={1.5}>
      <Box>
        {/* どちらも枠（「設定」のタブ・「全体の管理」）の中に出すので、見出しは h2（h1 と戻るリンクは枠にある） */}
        <HelpHeading
          variant="h6"
          component="h2"
          about="「監査ログ」"
          help={
            <>
              {scope === "all"
                ? "すべての wiki の記録と、ログイン・オーナーの変更・wiki の作成とアーカイブなど、全体にかかわる記録です。"
                : "この wiki での公開・メンバー・設定の変更・ページの削除などの記録です。"}
              本文の保存は、版履歴で見られます。並べ替えや移動は記録しません。記録は直したり消したりできません。
            </>
          }
        >
          {scope === "all" ? "監査ログ（すべての wiki）" : "監査ログ"}
        </HelpHeading>
      </Box>

      <Filters scope={scope} filter={filter} onChange={setFilter} />

      <Section sx={{ p: 0 }}>
        {logs.isPending && <Muted sx={{ p: 2 }}>読み込み中…</Muted>}
        {logs.error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {errorMessage(logs.error)}
          </Alert>
        )}
        {logs.data && entries.length === 0 && (
          <Box sx={{ p: 2 }}>
            {filtered ? (
              <Muted>条件に合う記録はありません。期間を広げるか、絞り込みを解除してください。</Muted>
            ) : (
              <Muted>まだ記録はありません。公開・メンバーの変更・設定の変更などをすると、ここに残ります。</Muted>
            )}
          </Box>
        )}
        {entries.length > 0 && (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} showWiki={scope === "all"} />
            ))}
          </Box>
        )}
        {logs.hasNextPage && (
          <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
            <Button onClick={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>
              {logs.isFetchingNextPage ? "読み込み中…" : "続きを読み込む"}
            </Button>
          </Box>
        )}
      </Section>
    </Stack>
  );
}

function Filters({ scope, filter, onChange }: { scope: AuditScope; filter: AuditLogFilter; onChange: (f: AuditLogFilter) => void }) {
  const actors = useQuery({ queryKey: ["audit-actors", scope], queryFn: () => api.listAuditActors(scope) });
  const wikis = useWikis();
  const set = (patch: AuditLogFilter) => onChange({ ...filter, ...patch });
  const thisYear = new Date().getFullYear();

  const wikiName = (key: string) => (key === GLOBAL ? "全体にかかわるもの" : (wikis.data?.wikis.find((w) => w.key === key)?.name ?? key));
  const actorName = (id: string) => actors.data?.actors.find((a) => a.userId === id)?.label ?? "選んだ人";
  const conditions = [
    filter.from || filter.to
      ? `期間：${filter.from ? formatDay(filter.from, thisYear) : ""}〜${filter.to ? formatDay(filter.to, thisYear) : ""}`
      : null,
    filter.actor ? `人：${actorName(filter.actor)}` : null,
    filter.category ? `分類：${AUDIT_CATEGORY_LABELS[filter.category as AuditCategory]}` : null,
    filter.wiki ? `wiki：${wikiName(filter.wiki)}` : null,
  ].filter(Boolean);

  return (
    <Section>
      <Row sx={{ gap: 1.5, alignItems: "flex-start" }}>
        <Field
          type="date"
          label="いつから"
          value={filter.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined })}
          slotProps={{ htmlInput: { max: filter.to } }}
        />
        <Field
          type="date"
          label="いつまで"
          value={filter.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined })}
          slotProps={{ htmlInput: { min: filter.from } }}
        />
        <Field select label="人" slotProps={selectSlots} value={filter.actor ?? ""} onChange={(e) => set({ actor: e.target.value || undefined })} sx={{ minWidth: 180 }}>
          <MenuItem value="">すべての人</MenuItem>
          {actors.data?.actors.map((a) => (
            <MenuItem key={a.userId} value={a.userId}>
              {a.label}
            </MenuItem>
          ))}
        </Field>
        <Field select label="分類" slotProps={selectSlots} value={filter.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })} sx={{ minWidth: 140 }}>
          <MenuItem value="">すべての分類</MenuItem>
          {AUDIT_CATEGORIES.map((c) => (
            <MenuItem key={c} value={c}>
              {AUDIT_CATEGORY_LABELS[c]}
            </MenuItem>
          ))}
        </Field>
        {scope === "all" && (
          <Field select label="wiki" slotProps={selectSlots} value={filter.wiki ?? ""} onChange={(e) => set({ wiki: e.target.value || undefined })} sx={{ minWidth: 180 }}>
            <MenuItem value="">すべて</MenuItem>
            <MenuItem value={GLOBAL}>全体にかかわるもの</MenuItem>
            {wikis.data?.wikis.map((w) => (
              <MenuItem key={w.key} value={w.key}>
                {w.name}
              </MenuItem>
            ))}
          </Field>
        )}
      </Row>
      {conditions.length > 0 && (
        <Row sx={{ mt: 1.5 }}>
          <Muted component="span">絞り込み中　{conditions.join("、")}</Muted>
          <Button size="small" onClick={() => onChange({})}>
            絞り込みを解除する
          </Button>
        </Row>
      )}
    </Section>
  );
}

function EntryRow({ entry, showWiki }: { entry: AuditLogEntry; showWiki: boolean }) {
  const pageId = entry.target?.type === "page" && entry.targetAvailable && entry.wiki ? entry.target.id : null;
  return (
    <Box
      component="li"
      sx={{
        display: "grid",
        // 日時の桁を揃え、狭い画面では文を下の行に回す
        gridTemplateColumns: { xs: "auto minmax(0, 1fr)", md: "auto 12em minmax(0, 1fr)" },
        columnGap: 2,
        rowGap: 0.25,
        px: 2,
        py: 1.25,
        "& + &": { borderTop: 1, borderColor: "divider" },
      }}
    >
      <Box component="time" dateTime={entry.createdAt} sx={{ fontFamily: monoFont, fontVariantNumeric: "tabular-nums", color: "text.secondary", fontSize: "0.85rem", pt: "2px" }}>
        {formatAuditTime(entry.createdAt)}
      </Box>
      <Box sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
        {entry.actor.label}
        {entry.actor.via && <Chip size="small" label={`${entry.actor.via} 経由`} variant="outlined" sx={{ ml: 1 }} />}
        {entry.actor.type === "system" && <Chip size="small" label="予約の実行" variant="outlined" sx={{ ml: 1 }} />}
      </Box>
      <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, minWidth: 0, overflowWrap: "anywhere" }}>
        {showWiki && <Chip size="small" label={entry.wiki?.name ?? "全体"} sx={{ mr: 1 }} />}
        {describeAudit(entry).map((part, i) =>
          part.target && pageId && entry.wiki ? (
            <RouterLink key={i} to="/w/$wikiKey/pages/$pageId" params={{ wikiKey: entry.wiki.key, pageId }}>
              {part.text}
            </RouterLink>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
        {(entry.ip || entry.actor.email) && entry.category === "login" && (
          <Muted sx={{ fontSize: "0.8rem" }}>
            {[entry.actor.email, entry.ip && `IP ${entry.ip}`, entry.userAgent].filter(Boolean).join("　")}
          </Muted>
        )}
      </Box>
    </Box>
  );
}
