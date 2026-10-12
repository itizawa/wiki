import { ArrowLeft } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OAUTH_SCOPES, type OAuthGrantSummary } from "@wiki/shared";
import { DataList, type DataListColumn } from "../components/DataList";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Mono, Muted, RouterLink, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useScreenTitle } from "../lib/documentTitle";

const SHORT_LABEL: Record<string, string> = {
  "wiki.read": "読む",
  "wiki.write": "書く",
  "wiki.private": "非公開も",
  "wiki.publish": "公開・予約",
  "wiki.delete": "削除",
  "wiki.suggest": "編集リクエスト",
};

/** 「許可しているアプリ」の行の高さ（読み込み中の行も、この高さで出す）。 */
const GRANT_ROW_HEIGHT = 54;

/** `/connections`：外部のアプリ（MCP クライアント）のつなぎ方と、自分が与えた許可の一覧・取り消し */
export function ConnectionsPage() {
  useScreenTitle("外部アプリ連携");
  const qc = useQueryClient();
  const grants = useQuery({ queryKey: ["oauth-grants"], queryFn: api.listGrants });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeGrant(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oauth-grants"] }),
  });
  const confirmRevoke = async (g: OAuthGrantSummary) => {
    const ok = await confirmDialog({
      title: `「${g.clientName}」の許可を取り消しますか`,
      body: "このアプリは、次のリクエストから wiki を操作できなくなります。また使うには、アプリの側からつなぎ直して、もう一度許可します。",
      confirmLabel: "取り消す",
      cancelLabel: "取り消さない",
      danger: true,
    });
    if (ok) revoke.mutate(g.id);
  };
  const columns: DataListColumn<OAuthGrantSummary>[] = [
    {
      key: "client",
      header: "アプリ",
      width: "minmax(200px, 1fr)",
      render: (g) => (
        <Box>
          {g.clientName}
          <Muted sx={{ fontSize: "0.75rem" }}>戻り先：{g.redirectHosts.join(", ")}</Muted>
        </Box>
      ),
    },
    {
      key: "scopes",
      header: "できること",
      render: (g) => <span title={g.scopes.map((s) => OAUTH_SCOPES[s].label).join("\n")}>{g.scopes.map((s) => SHORT_LABEL[s] ?? s).join("・")}</span>,
    },
    { key: "createdAt", header: "許可した日時", sx: { whiteSpace: "nowrap" }, render: (g) => formatDateTime(g.createdAt) },
    {
      key: "lastUsedAt",
      header: "最後に使った日時",
      sx: { whiteSpace: "nowrap" },
      render: (g) => (g.lastUsedAt ? formatDateTime(g.lastUsedAt) : "まだ使っていない"),
    },
    { key: "expiresAt", header: "期限", sx: { whiteSpace: "nowrap" }, render: (g) => formatDateTime(g.expiresAt) },
    {
      key: "actions",
      width: "max-content",
      align: "right",
      render: (g) => (
        <Button color="error" disabled={revoke.isPending} onClick={() => confirmRevoke(g)} sx={{ whiteSpace: "nowrap" }}>
          取り消す
        </Button>
      ),
    },
  ];
  const mcpUrl = `${location.origin}/mcp`;

  return (
    <Stack spacing={1.5}>
      <Box>
        <RouterLink to="/" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <ArrowLeft size={18} />
          wiki の画面に戻る
        </RouterLink>
        <HelpHeading variant="h5" component="h1" help="Claude などの AI エージェントから、MCP でページを探す・読む・書く・公開することができます。" sx={{ mt: 1 }}>
          外部アプリ連携
        </HelpHeading>
      </Box>

      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help="何を許すかは、つなぐときに選びます。公開・予約と削除は、許したアプリだけができます。作ったページは非公開の下書きから始まります。"
          sx={{ mb: 0.5 }}
        >
          つなぎ方
        </HelpHeading>
        <Stack spacing={1}>
          <Box>
            MCP サーバーの URL：<Mono>{mcpUrl}</Mono>
          </Box>
          <Muted>
            Claude では「設定 → コネクタ → カスタムコネクタを追加」にこの URL を入れます。Claude Code では{" "}
            <Mono>claude mcp add --transport http wiki {mcpUrl}</Mono> を実行します。つなぐと、この管理画面で許可するかを聞かれます。
          </Muted>
        </Stack>
      </Section>

      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          許可しているアプリ
        </Typography>
        {revoke.error && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
        <DataList
          label="許可しているアプリ"
          columns={columns}
          rows={grants.data?.grants}
          rowKey={(g) => g.id}
          error={grants.error}
          empty="許可しているアプリはありません。"
          rowHeight={GRANT_ROW_HEIGHT}
          skeletonRows={3}
        />
      </Section>

    </Stack>
  );
}
