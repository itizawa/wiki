import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { CostServiceReport, CostUsageMetric } from "@wiki/shared";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { Mono, Muted, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { costFailureText, formatUsage, usageChange, usageOf } from "../lib/costs";
import { formatDateTime } from "../lib/format";
import { useSession } from "./Layout";

const ROW_HEIGHT = 52;

/** `2026-10` を「2026年10月」に */
const monthLabel = (period: string) => `${period.slice(0, 4)}年${Number(period.slice(5))}月`;

/** 運用コスト（サービスごとの使用量）。オーナーにだけ出す。請求額を API で取れないサービスは、使用量だけを出す（料金は計算しない）。 */
export function CostsPage() {
  const session = useSession();
  const costs = useQuery({ queryKey: ["costs"], queryFn: api.costs, enabled: session.isOwner });

  return (
    <Stack spacing={1.5}>
      {/* 「wiki の画面に戻る」とページの見出し（h1）は、「全体の管理」の枠（GlobalAdminLayout）にある */}
      <HelpHeading
        variant="h6"
        component="h2"
        help="サービスごとの使用量を、1日1回（日本時間の午前3時）に取って控えています。請求額は取れないので、金額は出さず、使用量だけを出しています。今月は月の途中までの数字です。月は UTC で区切っています。"
      >
        コスト
      </HelpHeading>

      {!session.isOwner && <Alert severity="info">コストは、オーナーだけが見られます。</Alert>}
      {costs.error && <Alert severity="error">{errorMessage(costs.error)}</Alert>}

      {session.isOwner &&
        (costs.data ? (
          costs.data.services.map((service) => (
            <ServiceSection key={service.service} service={service} currentPeriod={costs.data.currentPeriod} previousPeriod={costs.data.previousPeriod} />
          ))
        ) : (
          !costs.error && <ServiceSkeleton />
        ))}
    </Stack>
  );
}

function ServiceSkeleton() {
  return (
    <Section>
      <Typography variant="subtitle1" component="h3" gutterBottom>
        読み込み中
      </Typography>
      <DataList label="使用量" columns={columns("", "", [null, null])} rows={undefined} rowKey={(m) => m.key} empty="" rowHeight={ROW_HEIGHT} skeletonRows={4} />
    </Section>
  );
}

function columns(currentLabel: string, previousLabel: string, usage: [Record<string, number> | null, Record<string, number> | null]): DataListColumn<CostUsageMetric>[] {
  const [current, previous] = usage;
  return [
    { key: "label", header: "項目", width: "minmax(180px, 1.4fr)", render: (m) => <Box sx={{ fontWeight: 600 }}>{m.label}</Box> },
    {
      key: "current",
      header: `今月（${currentLabel}）`,
      width: "minmax(120px, 1fr)",
      render: (m) => (current ? formatUsage(usageOf(current, m.key) ?? 0, m.unit) : <Muted component="span">まだ取れていません</Muted>),
    },
    {
      key: "previous",
      header: `前月（${previousLabel}）`,
      width: "minmax(120px, 1fr)",
      render: (m) => (previous ? formatUsage(usageOf(previous, m.key) ?? 0, m.unit) : <Muted component="span">データなし</Muted>),
    },
    { key: "change", header: "前月比", width: "minmax(90px, 0.6fr)", render: (m) => usageChange(usageOf(current, m.key), usageOf(previous, m.key)) },
  ];
}

function ServiceSection({ service, currentPeriod, previousPeriod }: { service: CostServiceReport; currentPeriod: string; previousPeriod: string }) {
  const failure = service.error ? costFailureText(service.error) : null;
  const hasUsage = service.current !== null || service.previous !== null;
  return (
    <Section>
      <Typography variant="subtitle1" component="h3" gutterBottom>
        {service.label}
      </Typography>

      {!service.configured ? (
        <Alert severity="info">
          まだつないでいません。Neon のコンソールで API キーを作り、API の Worker のシークレットに <Mono>NEON_API_KEY</Mono> と、組織 ID の <Mono>NEON_ORG_ID</Mono> を登録すると、翌日の取得から出ます。手順は README の「運用コスト」にあります。
        </Alert>
      ) : (
        <Stack spacing={1}>
          {failure && (
            <Alert severity="warning">
              {failure.what}
              {hasUsage ? "下の数字は、前に取れたものです。" : ""}
              {failure.fix}
            </Alert>
          )}
          {service.fetchedAt ? (
            <Muted>{formatDateTime(service.fetchedAt)} 時点の数字</Muted>
          ) : (
            !failure && <Muted>まだ取得していません。取得は1日1回で、最初の取得は翌日の日本時間の午前3時です。</Muted>
          )}
          {hasUsage && (
            <DataList
              label={`${service.label}の使用量`}
              columns={columns(monthLabel(currentPeriod), monthLabel(previousPeriod), [service.current, service.previous])}
              rows={service.metrics}
              rowKey={(m) => m.key}
              empty="使用量はありません。"
              rowHeight={ROW_HEIGHT}
            />
          )}
        </Stack>
      )}
    </Section>
  );
}
