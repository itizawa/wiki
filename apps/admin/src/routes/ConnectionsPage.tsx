import { ArrowLeft } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OAUTH_SCOPES, type OAuthGrantSummary } from "@wiki/shared";
import { confirmDialog } from "../components/ConfirmDialog";
import { Mono, Muted, RouterLink, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";

const SHORT_LABEL: Record<string, string> = {
  "wiki.read": "読む",
  "wiki.write": "書く",
  "wiki.private": "非公開も",
  "wiki.publish": "公開・予約・承認",
  "wiki.delete": "削除",
};

/** `/connections`：外部のアプリ（MCP クライアント）のつなぎ方と、自分が与えた許可の一覧・取り消し */
export function ConnectionsPage() {
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
  const mcpUrl = `${location.origin}/mcp`;

  return (
    <Stack spacing={1.5}>
      <Box>
        <RouterLink to="/" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <ArrowLeft size={18} />
          wiki の画面に戻る
        </RouterLink>
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          外部アプリ連携
        </Typography>
        <Muted>Claude などの AI エージェントから、MCP でページを探す・読む・書く・公開することができます。</Muted>
      </Box>

      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          つなぎ方
        </Typography>
        <Stack spacing={1}>
          <Box>
            MCP サーバーの URL：<Mono>{mcpUrl}</Mono>
          </Box>
          <Muted>
            Claude では「設定 → コネクタ → カスタムコネクタを追加」にこの URL を入れます。Claude Code では{" "}
            <Mono>claude mcp add --transport http wiki {mcpUrl}</Mono> を実行します。つなぐと、この管理画面で許可するかを聞かれます。
          </Muted>
          <Muted>
            何を許すかは、つなぐときに選びます。公開・予約・承認と削除は、許したアプリだけができます。作ったページは非公開の下書きから始まります。
          </Muted>
        </Stack>
      </Section>

      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          許可しているアプリ
        </Typography>
        {revoke.error && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
        {grants.error && <Alert severity="error">{errorMessage(grants.error)}</Alert>}
        {grants.isPending && <Muted>読み込み中…</Muted>}
        {grants.data && grants.data.grants.length === 0 && <Muted>許可しているアプリはありません。</Muted>}
        {grants.data && grants.data.grants.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>アプリ</TableCell>
                  <TableCell>できること</TableCell>
                  <TableCell>許可した日時</TableCell>
                  <TableCell>最後に使った日時</TableCell>
                  <TableCell>期限</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {grants.data.grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      {g.clientName}
                      <Muted sx={{ fontSize: "0.75rem" }}>戻り先：{g.redirectHosts.join(", ")}</Muted>
                    </TableCell>
                    <TableCell title={g.scopes.map((s) => OAUTH_SCOPES[s].label).join("\n")}>
                      {g.scopes.map((s) => SHORT_LABEL[s] ?? s).join("・")}
                    </TableCell>
                    <TableCell>{formatDateTime(g.createdAt)}</TableCell>
                    <TableCell>{g.lastUsedAt ? formatDateTime(g.lastUsedAt) : "まだ使っていない"}</TableCell>
                    <TableCell>{formatDateTime(g.expiresAt)}</TableCell>
                    <TableCell align="right">
                      <Button color="error" disabled={revoke.isPending} onClick={() => confirmRevoke(g)}>
                        取り消す
                      </Button>
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
