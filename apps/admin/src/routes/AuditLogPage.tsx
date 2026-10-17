import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABELS, describeAudit, formatAuditTime, type AuditLogEntry } from "@wiki/shared";
import { useState } from "react";
import { HelpHeading } from "../components/HelpTip";
import {
  ListToolbar,
  appliedFiltersText,
  filterValues,
  parseDateRange,
  type ActiveFilter,
  type FilterField,
  type SortDirection,
  type SortField,
  type SortValue,
} from "../components/ListToolbar";
import { Muted, RouterLink, Section } from "../components/ui";
import { api, errorMessage, type AuditLogFilter, type AuditScope } from "../lib/api";
import { monoFont } from "../theme";
import { useWikis } from "./Layout";

const GLOBAL = "global";

const SORT_FIELDS: SortField[] = [{ key: "createdAt", label: "日時", asc: "古い順", desc: "新しい順" }];

/** 絞り込める列。人と wiki の選択肢は、読み込んでから入る。wiki は全体の一覧（`all`）だけ */
export function auditFilterFields(
  scope: AuditScope,
  actors: readonly { userId: string; label: string }[],
  wikis: readonly { key: string; name: string }[],
): FilterField[] {
  const fields: FilterField[] = [
    { key: "period", label: "期間", kind: "dateRange" },
    { key: "actor", label: "人", kind: "select", options: actors.map((a) => ({ value: a.userId, label: a.label })) },
    { key: "category", label: "分類", kind: "select", options: AUDIT_CATEGORIES.map((c) => ({ value: c, label: AUDIT_CATEGORY_LABELS[c] })) },
  ];
  if (scope === "all") {
    fields.push({ key: "wiki", label: "wiki", kind: "select", options: [{ value: GLOBAL, label: "全体にかかわるもの" }, ...wikis.map((w) => ({ value: w.key, label: w.name }))] });
  }
  return fields;
}

/** 条件と並びを、API に渡す形にする（値を選んでいない条件は渡さない） */
export function auditLogFilter(filters: ActiveFilter[], order: SortDirection): AuditLogFilter {
  const { from, to } = parseDateRange(filterValues(filters, "period")?.[0]);
  const filter: AuditLogFilter = { from, to, actor: filterValues(filters, "actor"), category: filterValues(filters, "category"), wiki: filterValues(filters, "wiki"), order };
  // 問い合わせのキーに、空の値を残さない
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as AuditLogFilter;
}

/**
 * 監査ログ：重要な操作を「いつ・誰が・何をした」の文で、日時の順（はじめは新しい順）に出す。期間・人・分類（全体の一覧では wiki も）で絞れる。
 * scope が wiki なら開いている wiki のもの（管理者）、all ならすべての wiki と全体にかかわるもの（オーナー）。
 * 絞り込みと並びは画面の中だけに持つ（URL には入れない）。
 */
export function AuditLogPage({ scope }: { scope: AuditScope }) {
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [sort, setSort] = useState<SortValue>({ key: "createdAt", direction: "desc" });
  const actors = useQuery({ queryKey: ["audit-actors", scope], queryFn: () => api.listAuditActors(scope) });
  const wikis = useWikis();
  const filterFields = auditFilterFields(scope, actors.data?.actors ?? [], wikis.data?.wikis ?? []);
  const filter = auditLogFilter(filters, sort.direction);
  const logs = useInfiniteQuery({
    queryKey: ["audit-logs", scope, filter],
    queryFn: ({ pageParam }) => api.listAuditLogs(scope, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = logs.data?.pages.flatMap((p) => p.entries) ?? [];
  const applied = appliedFiltersText(filterFields, filters);

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

      <Box>
        <ListToolbar
          label="監査ログの絞り込みと並べ替え"
          sortFields={SORT_FIELDS}
          sort={sort}
          onSortChange={setSort}
          filterFields={filterFields}
          filters={filters}
          onFiltersChange={setFilters}
        />

        <Section sx={{ p: 0 }}>
          {logs.isPending && <Muted sx={{ p: 2 }}>読み込み中…</Muted>}
          {logs.error && (
            <Alert severity="error" sx={{ m: 2 }}>
              {errorMessage(logs.error)}
            </Alert>
          )}
          {logs.data && entries.length === 0 && (
            <Box sx={{ p: 2 }}>
              {applied ? (
                <Muted>
                  条件（{applied}）に合う記録はありません。{" "}
                  <Link component="button" type="button" onClick={() => setFilters([])} sx={{ verticalAlign: "baseline" }}>
                    絞り込みをすべて外す
                  </Link>
                </Muted>
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
      </Box>
    </Stack>
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
