import { Copy } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { INVITE_TTL_DAYS, WIKI_ROLE_LABELS, WIKI_ROLES, type Invite, type InviteStatus, type Member, type WikiRole } from "@wiki/shared";
import { useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Tooltip } from "../components/Tooltip";
import { Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useWiki } from "../lib/wiki";
import { useSession } from "./Layout";

const STATUS_LABELS: Record<InviteStatus, { label: string; color: "success" | "default" | "warning" }> = {
  active: { label: "使える", color: "success" },
  used: { label: "使用済み", color: "default" },
  expired: { label: "期限切れ", color: "warning" },
  revoked: { label: "無効", color: "default" },
};

/** メンバー：一覧（メンバーなら誰でも見られる）、ロールの変更・削除と招待リンク（管理者だけ）、自分で抜ける。 */
export function MembersPage() {
  const { wiki, role } = useWiki();
  const isAdmin = role === "admin";
  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h1">
          メンバー
        </Typography>
        <Muted>
          「{wiki.name}」に入れる人です。編集者はページの作成・編集・公開まで、管理者はそれに加えて招待・メンバーの管理ができます。
          オーナーは一覧に出なくても、すべての wiki に管理者として入れます。
        </Muted>
      </Section>
      <Members isAdmin={isAdmin} />
      {isAdmin && <Invites />}
    </Stack>
  );
}

function Members({ isAdmin }: { isAdmin: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const members = useQuery({ queryKey: ["members"], queryFn: api.listMembers });
  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: WikiRole }) => api.changeRole(input.userId, input.role),
    onSuccess: (res) => qc.setQueryData(["members"], res),
  });
  const remove = useMutation({
    mutationFn: (member: Member) => api.removeMember(member.userId),
    onSuccess: async (_res, member) => {
      if (member.userId === session.id) {
        // 自分で抜けたら、この wiki はもう開けない
        await qc.invalidateQueries({ queryKey: ["wikis"] });
        await qc.invalidateQueries({ queryKey: ["me"] });
        await navigate({ to: "/" });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const list = members.data?.members ?? [];
  const admins = list.filter((m) => m.role === "admin").length;
  const error = changeRole.error ?? remove.error;

  const confirmRemove = async (member: Member) => {
    const self = member.userId === session.id;
    const ok = await confirmDialog(
      self
        ? {
            title: "この wiki から抜けますか？",
            body: "抜けると、この wiki を開けなくなります。戻るには、管理者から新しい招待リンクを受け取ってください。あなたが書いたページや履歴は残ります。",
            confirmLabel: "抜ける",
            cancelLabel: "抜けずに戻る",
            danger: true,
          }
        : {
            title: `${member.name ?? member.email} をメンバーから外しますか？`,
            body: "外した人は、次の操作からこの wiki を開けなくなります。その人が書いたページや履歴は残ります。",
            confirmLabel: "メンバーから外す",
            cancelLabel: "外さずに戻る",
            danger: true,
          },
    );
    if (ok) remove.mutate(member);
  };

  return (
    <Section>
      <Typography variant="h6" component="h2" gutterBottom>
        メンバーの一覧
      </Typography>
      {members.isPending && <Muted>読み込み中…</Muted>}
      {members.error && <Alert severity="error">{errorMessage(members.error)}</Alert>}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage(error)}
        </Alert>
      )}
      {members.data && list.length === 0 && <Muted>メンバーはいません。オーナーだけが入れます。</Muted>}
      {list.length > 0 && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>名前 / メールアドレス</TableCell>
                <TableCell>ロール</TableCell>
                <TableCell>参加した日</TableCell>
                <TableCell>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((m) => {
                const self = m.userId === session.id;
                // メンバーの管理者が0人になる操作は止める（オーナーは数えない）
                const lastAdmin = m.role === "admin" && admins <= 1;
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <Box sx={{ fontWeight: 600 }}>
                        {m.name ?? m.email}
                        {self && <Chip size="small" label="自分" sx={{ ml: 1 }} />}
                        {m.isOwner && <Chip size="small" label="オーナー" variant="outlined" sx={{ ml: 1 }} />}
                      </Box>
                      {m.name && <Muted>{m.email}</Muted>}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <>
                          <TextField
                            select
                            size="small"
                            value={m.role}
                            disabled={lastAdmin || changeRole.isPending}
                            onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as WikiRole })}
                            slotProps={{ htmlInput: { "aria-label": `${m.name ?? m.email} のロール` } }}
                            sx={{ minWidth: 120 }}
                          >
                            {WIKI_ROLES.map((r) => (
                              <MenuItem key={r} value={r}>
                                {WIKI_ROLE_LABELS[r]}
                              </MenuItem>
                            ))}
                          </TextField>
                          {lastAdmin && <Muted sx={{ mt: 0.5 }}>最後の管理者なので、変えられません</Muted>}
                        </>
                      ) : (
                        WIKI_ROLE_LABELS[m.role]
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell>
                      {(self || isAdmin) && (
                        <Tooltip title={lastAdmin ? "最後の管理者です。先にほかのメンバーを管理者にしてください" : ""}>
                          {/* 無効のボタンにもツールチップを出すため、span で包む */}
                          <span>
                            <Button variant="outlined" color="error" disabled={lastAdmin || remove.isPending} onClick={() => confirmRemove(m)}>
                              {self ? "抜ける" : "外す"}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Section>
  );
}

function Invites() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ["invites"], queryFn: api.listInvites });
  const [role, setRole] = useState<WikiRole>("editor");
  const [issued, setIssued] = useState<{ url: string; role: WikiRole } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.createInvite(role),
    onSuccess: async (res) => {
      setIssued({ url: `${location.origin}/invite#${res.token}`, role: res.invite.role });
      setCopied(false);
      await qc.invalidateQueries({ queryKey: ["invites"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (invite: Invite) => api.revokeInvite(invite.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    setCopied(true);
  };

  const confirmRevoke = async (invite: Invite) => {
    const ok = await confirmDialog({
      title: "この招待リンクを無効にしますか？",
      body: "無効にしたリンクでは参加できなくなります。元には戻せません。",
      confirmLabel: "無効にする",
      cancelLabel: "無効にせずに戻る",
      danger: true,
    });
    if (ok) revoke.mutate(invite);
  };

  return (
    <Section>
      <Typography variant="h6" component="h2">
        招待リンク
      </Typography>
      <Muted sx={{ mb: 1.5 }}>
        1つのリンクで1人が参加できます。期限は{INVITE_TTL_DAYS}日です。メールは送らないので、発行したリンクを自分で伝えてください。
      </Muted>
      <Row>
        <TextField select size="small" label="参加する人のロール" value={role} onChange={(e) => setRole(e.target.value as WikiRole)} sx={{ minWidth: 180 }}>
          {WIKI_ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {WIKI_ROLE_LABELS[r]}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" disabled={create.isPending} onClick={() => create.mutate()}>
          招待リンクを発行する
        </Button>
      </Row>
      {create.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {errorMessage(create.error)}
        </Alert>
      )}
      {issued && (
        <Alert severity="success" sx={{ mt: 1.5 }} onClose={() => setIssued(null)}>
          <Box sx={{ mb: 1 }}>
            {WIKI_ROLE_LABELS[issued.role]}として参加するリンクを発行しました。<strong>このリンクは今だけ表示します。</strong>コピーして、参加する人に伝えてください。
          </Box>
          <Row sx={{ flexWrap: "nowrap" }}>
            <TextField
              size="small"
              value={issued.url}
              fullWidth
              slotProps={{ htmlInput: { readOnly: true, "aria-label": "招待リンク", onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select() } }}
            />
            <Button variant="outlined" startIcon={<Copy size={16} />} onClick={copy} sx={{ flexShrink: 0 }}>
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </Row>
        </Alert>
      )}

      <Typography variant="subtitle2" component="h3" sx={{ mt: 2.5, mb: 0.5 }}>
        発行したリンク
      </Typography>
      {invites.isPending && <Muted>読み込み中…</Muted>}
      {invites.error && <Alert severity="error">{errorMessage(invites.error)}</Alert>}
      {revoke.error && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
      {invites.data && invites.data.invites.length === 0 && <Muted>まだ発行していません。</Muted>}
      {invites.data && invites.data.invites.length > 0 && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ロール</TableCell>
                <TableCell>発行した人</TableCell>
                <TableCell>期限</TableCell>
                <TableCell>状態</TableCell>
                <TableCell>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invites.data.invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{WIKI_ROLE_LABELS[i.role]}</TableCell>
                  <TableCell>{i.createdBy.name ?? i.createdBy.email}</TableCell>
                  <TableCell>{formatDateTime(i.expiresAt)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={STATUS_LABELS[i.status].label} color={STATUS_LABELS[i.status].color} />
                    {i.usedBy && <Muted component="span">　{i.usedBy.name ?? i.usedBy.email} が参加</Muted>}
                  </TableCell>
                  <TableCell>
                    {i.status === "active" && (
                      <Button variant="text" color="error" disabled={revoke.isPending} onClick={() => confirmRevoke(i)}>
                        無効にする
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Section>
  );
}
