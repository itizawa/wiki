import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserSummary } from "@wiki/shared";
import { ConfirmHost, confirmDialog } from "../components/ConfirmDialog";
import { Tooltip } from "../components/Tooltip";
import { Muted, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession } from "./Layout";

/** オーナーの追加・解除。オーナーにだけ出す。オーナーにできるのは、登録済みのユーザー（一度は招待で参加した人など）。 */
export function OwnersPage() {
  const session = useSession();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers, enabled: session.isOwner });
  const setOwner = useMutation({
    mutationFn: (input: { user: UserSummary; isOwner: boolean }) => api.setOwner(input.user.id, input.isOwner),
    onSuccess: async (res, input) => {
      qc.setQueryData(["users"], res);
      // 自分を解除したら、入れる wiki と画面が変わる
      if (input.user.id === session.id) {
        await qc.invalidateQueries({ queryKey: ["me"] });
        await qc.invalidateQueries({ queryKey: ["wikis"] });
      }
    },
  });

  const list = users.data?.users ?? [];
  const owners = list.filter((u) => u.isOwner).length;

  const toggle = async (user: UserSummary) => {
    const name = user.name ?? user.email;
    const ok = await confirmDialog(
      user.isOwner
        ? {
            title: `${name} をオーナーから外しますか？`,
            body: "wiki の作成・アーカイブと、メンバーでない wiki を開くことができなくなります。メンバーとして入っている wiki には、そのロールで入れます。",
            confirmLabel: "オーナーから外す",
            cancelLabel: "外さずに戻る",
            danger: true,
          }
        : {
            title: `${name} をオーナーにしますか？`,
            body: "すべての wiki に管理者として入れ、wiki の作成・アーカイブと、オーナーの追加・解除ができるようになります。",
            confirmLabel: "オーナーにする",
            cancelLabel: "やめる",
          },
    );
    if (ok) setOwner.mutate({ user, isOwner: !user.isOwner });
  };

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      {/* 「wiki の画面に戻る」とページの見出し（h1）は、「全体の管理」の枠（GlobalAdminLayout）にある */}
      <Box>
        <Typography variant="h6" component="h2">
          オーナー
        </Typography>
        <Muted>
          オーナーは、すべての wiki に管理者として入れ、wiki の作成・アーカイブと、オーナーの追加・解除ができます。オーナーにできるのは、招待で参加した人など、登録済みのユーザーです。
        </Muted>
      </Box>

      {!session.isOwner && <Alert severity="info">オーナーの追加・解除は、オーナーだけが行えます。</Alert>}
      {users.error && <Alert severity="error">{errorMessage(users.error)}</Alert>}
      {setOwner.error && <Alert severity="error">{errorMessage(setOwner.error)}</Alert>}

      {session.isOwner && (
        <Section>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            登録済みのユーザー
          </Typography>
          {users.isPending && <Muted>読み込み中…</Muted>}
          {list.length > 0 && (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>名前 / メールアドレス</TableCell>
                    <TableCell>最後のログイン</TableCell>
                    <TableCell>オーナー</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.map((u) => {
                    const lastOwner = u.isOwner && owners <= 1;
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <Box sx={{ fontWeight: 600 }}>
                            {u.name ?? u.email}
                            {u.id === session.id && <Chip size="small" label="自分" sx={{ ml: 1 }} />}
                          </Box>
                          {u.name && <Muted>{u.email}</Muted>}
                        </TableCell>
                        <TableCell>
                          {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <Muted component="span">まだログインしていません</Muted>}
                          {!u.linked && (
                            <Muted sx={{ fontSize: 12 }}>このメールアドレスで最初にログインした Google アカウントに結びつきます</Muted>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.isOwner && <Chip size="small" color="primary" label="オーナー" sx={{ mr: 1.5 }} />}
                          <Tooltip title={lastOwner ? "最後のオーナーは解除できません。先にほかの人をオーナーにしてください" : ""}>
                            <span>
                              <Button
                                variant="outlined"
                                color={u.isOwner ? "error" : "primary"}
                                disabled={lastOwner || setOwner.isPending}
                                onClick={() => toggle(u)}
                              >
                                {u.isOwner ? "オーナーから外す" : "オーナーにする"}
                              </Button>
                            </span>
                          </Tooltip>
                          {lastOwner && <Muted sx={{ mt: 0.5 }}>最後のオーナーなので、外せません</Muted>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>
      )}
    </Stack>
  );
}
