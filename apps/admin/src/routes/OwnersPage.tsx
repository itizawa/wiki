import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserSummary } from "@wiki/shared";
import { DataList, type DataListColumn } from "../components/DataList";
import { ConfirmHost, confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Tooltip } from "../components/Tooltip";
import { Muted, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession } from "./Layout";

/** 一覧の行の高さ（読み込み中の行も、この高さで出す） */
const OWNER_ROW_HEIGHT = 64;

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

  const columns: DataListColumn<UserSummary>[] = [
    {
      key: "name",
      header: "名前 / メールアドレス",
      width: "minmax(200px, 1fr)",
      render: (u) => (
        <Box>
          <Box sx={{ fontWeight: 600 }}>
            {u.name ?? u.email}
            {u.id === session.id && <Chip size="small" label="自分" sx={{ ml: 1 }} />}
          </Box>
          {u.name && <Muted>{u.email}</Muted>}
        </Box>
      ),
    },
    {
      key: "lastLoginAt",
      header: "最後のログイン",
      render: (u) => (
        <Box>
          {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <Muted component="span">まだログインしていません</Muted>}
          {!u.linked && <Muted sx={{ fontSize: 12 }}>このメールアドレスで最初にログインした Google アカウントに結びつきます</Muted>}
        </Box>
      ),
    },
    {
      key: "owner",
      header: "オーナー",
      render: (u) => {
        const lastOwner = u.isOwner && owners <= 1;
        return (
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              {u.isOwner && <Chip size="small" color="primary" label="オーナー" />}
              <Tooltip title={lastOwner ? "最後のオーナーは解除できません。先にほかの人をオーナーにしてください" : ""}>
                <span>
                  <Button
                    variant="outlined"
                    color={u.isOwner ? "error" : "primary"}
                    disabled={lastOwner || setOwner.isPending}
                    onClick={() => toggle(u)}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    {u.isOwner ? "オーナーから外す" : "オーナーにする"}
                  </Button>
                </span>
              </Tooltip>
            </Box>
            {lastOwner && <Muted sx={{ mt: 0.5, whiteSpace: "nowrap" }}>最後のオーナーなので、外せません</Muted>}
          </Box>
        );
      },
    },
  ];

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      {/* 「wiki の画面に戻る」とページの見出し（h1）は、「全体の管理」の枠（GlobalAdminLayout）にある */}
      <Box>
        <HelpHeading
          variant="h6"
          component="h2"
          help="オーナーは、すべての wiki に管理者として入れ、wiki の作成・アーカイブと、オーナーの追加・解除ができます。オーナーにできるのは、招待で参加した人など、登録済みのユーザーです。"
        >
          オーナー
        </HelpHeading>
      </Box>

      {!session.isOwner && <Alert severity="info">オーナーの追加・解除は、オーナーだけが行えます。</Alert>}
      {users.error && <Alert severity="error">{errorMessage(users.error)}</Alert>}
      {setOwner.error && <Alert severity="error">{errorMessage(setOwner.error)}</Alert>}

      {session.isOwner && (
        <Section>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            登録済みのユーザー
          </Typography>
          {/* 読み込みのエラーは、上で出している */}
          <DataList
            label="登録済みのユーザー"
            columns={columns}
            rows={users.data ? list : undefined}
            rowKey={(u) => u.id}
            empty="登録済みのユーザーはいません。"
            rowHeight={OWNER_ROW_HEIGHT}
            skeletonRows={3}
          />
        </Section>
      )}
    </Stack>
  );
}
