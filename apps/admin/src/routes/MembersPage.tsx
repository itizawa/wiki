import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import { INVITE_TTL_DAYS, WIKI_ROLE_LABELS, WIKI_ROLES, type CreatedInvite, type Invite, type User, type WikiMember, type WikiRole } from "@wiki/shared";
import { useState, type FocusEvent } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Muted, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useWiki } from "../lib/wiki";
import { useSession } from "./Layout";

const INVITE_STATUS_LABELS: Record<Invite["status"], string> = {
  active: "使える",
  used: "使用済み",
  expired: "期限切れ",
  revoked: "無効",
};

const displayName = (u: User) => u.name ?? u.email;

/**
 * メンバー：この wiki に入れる人と、招待リンク。
 * 一覧はメンバー全員が見られる。ロールの変更・外す・招待は管理者だけ（自分で抜けるのは誰でも）。
 */
export function MembersPage() {
  const { wiki } = useWiki();
  const isAdmin = wiki.role === "admin";
  const members = useQuery({ queryKey: ["members"], queryFn: api.listMembers });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2">
          メンバー
        </Typography>
        <Muted>
          この wiki に入れるのは、メンバーとオーナーだけです。編集者はページを書いて公開まで進められます。メンバーと招待の管理、ルールの設定は管理者だけができます。
        </Muted>
      </Section>
      {members.error && <Alert severity="error">{errorMessage(members.error)}</Alert>}
      {members.data && <MemberList members={members.data.members} isAdmin={isAdmin} />}
      {isAdmin && <Invites />}
    </Stack>
  );
}

function MemberList({ members, isAdmin }: { members: WikiMember[]; isAdmin: boolean }) {
  const session = useSession();
  const { wiki } = useWiki();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    setError(null);
    await qc.invalidateQueries({ queryKey: ["members"] });
  };
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: WikiRole }) => api.changeRole(v.userId, v.role),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(userId),
    onError: (e) => setError(errorMessage(e)),
  });

  const removeMember = async (m: WikiMember) => {
    const self = m.user.id === session.id;
    const ok = await confirmDialog(
      self
        ? {
            title: `「${wiki.name}」から抜けますか？`,
            body: "抜けると、この wiki を開けなくなります。戻るには、管理者に新しい招待リンクを頼んでください。",
            confirmLabel: "抜ける",
            cancelLabel: "抜けずに戻る",
            danger: true,
          }
        : {
            title: `${displayName(m.user)} をメンバーから外しますか？`,
            body: "次の操作から、この wiki を開けなくなります。書いた版や履歴は残ります。",
            confirmLabel: "外す",
            cancelLabel: "外さずに戻る",
            danger: true,
          },
    );
    if (!ok) return;
    remove.mutate(m.user.id, {
      onSuccess: async () => {
        if (self && !session.isOwner) {
          // 抜けた wiki はもう開けないので、一覧を取り直して最初の画面へ
          await qc.invalidateQueries({ queryKey: ["wikis"] });
          await navigate({ to: "/" });
          return;
        }
        await done();
      },
    });
  };

  return (
    <Section>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Table size="small" aria-label="メンバー">
        <TableHead>
          <TableRow>
            <TableCell>名前</TableCell>
            <TableCell>ロール</TableCell>
            <TableCell>参加した日</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((m) => {
            const self = m.user.id === session.id;
            return (
              <TableRow key={m.user.id}>
                <TableCell>
                  <Box>
                    {displayName(m.user)}
                    {self && <Muted component="span">（あなた）</Muted>}
                  </Box>
                  {m.user.name && <Muted>{m.user.email}</Muted>}
                </TableCell>
                <TableCell>
                  {isAdmin ? (
                    <TextField
                      select
                      size="small"
                      value={m.role}
                      disabled={changeRole.isPending}
                      onChange={(e) => changeRole.mutate({ userId: m.user.id, role: e.target.value as WikiRole })}
                      slotProps={{ htmlInput: { "aria-label": `${displayName(m.user)} のロール` } }}
                      sx={{ minWidth: 120 }}
                    >
                      {WIKI_ROLES.map((r) => (
                        <MenuItem key={r} value={r}>
                          {WIKI_ROLE_LABELS[r]}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    WIKI_ROLE_LABELS[m.role]
                  )}
                </TableCell>
                <TableCell>{formatDateTime(m.joinedAt)}</TableCell>
                <TableCell align="right">
                  {(isAdmin || self) && (
                    <Button variant="text" color="error" disabled={remove.isPending} onClick={() => removeMember(m)}>
                      {self ? "抜ける" : "外す"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {session.isOwner && !members.some((m) => m.user.id === session.id) && (
        <Muted sx={{ mt: 1 }}>あなたはオーナーなので、メンバーでなくても管理者としてこの wiki を開けます。</Muted>
      )}
    </Section>
  );
}

function Invites() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ["invites"], queryFn: api.listInvites });
  const [role, setRole] = useState<WikiRole>("editor");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.createInvite(role),
    onSuccess: async (invite) => {
      setCreated(invite);
      setCopied(false);
      await qc.invalidateQueries({ queryKey: ["invites"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // コピーできない環境では、欄を選んで手でコピーしてもらう
    }
  };

  return (
    <Section>
      <Typography variant="h6" component="h2" gutterBottom>
        招待リンク
      </Typography>
      <Muted sx={{ mb: 1.5 }}>
        1つのリンクで入れるのは1人です。期限は発行から{INVITE_TTL_DAYS}日。メールは送らないので、リンクは発行した人が相手に伝えてください。
      </Muted>
      <Row sx={{ mb: 1.5 }}>
        <TextField select size="small" label="ロール" value={role} onChange={(e) => setRole(e.target.value as WikiRole)} sx={{ minWidth: 140 }}>
          {WIKI_ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {WIKI_ROLE_LABELS[r]}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" size="medium" disabled={create.isPending} onClick={() => create.mutate()}>
          招待リンクを発行する
        </Button>
      </Row>
      {create.error && <Alert severity="error">{errorMessage(create.error)}</Alert>}
      {created && (
        <Alert severity="success" onClose={() => setCreated(null)} sx={{ mb: 1.5 }}>
          {WIKI_ROLE_LABELS[created.role]}の招待リンクを発行しました。このリンクはいまだけ表示します。閉じる前にコピーしてください。
          <Row sx={{ mt: 1, flexWrap: "nowrap" }}>
            <TextField
              size="small"
              value={created.url}
              fullWidth
              slotProps={{ htmlInput: { readOnly: true, "aria-label": "招待リンク", onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select() } }}
            />
            <Button variant="outlined" onClick={() => copy(created.url)} sx={{ flexShrink: 0 }}>
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </Row>
        </Alert>
      )}
      {revoke.error && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
      {invites.data && invites.data.invites.length === 0 && <Muted>発行した招待リンクはありません。</Muted>}
      {invites.data && invites.data.invites.length > 0 && (
        <Table size="small" aria-label="発行した招待リンク">
          <TableHead>
            <TableRow>
              <TableCell>ロール</TableCell>
              <TableCell>発行した人</TableCell>
              <TableCell>期限</TableCell>
              <TableCell>状態</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {invites.data.invites.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{WIKI_ROLE_LABELS[inv.role]}</TableCell>
                <TableCell>{displayName(inv.createdBy)}</TableCell>
                <TableCell>{formatDateTime(inv.expiresAt)}</TableCell>
                <TableCell>
                  <StatusChip size="small" status={inv.status === "active" ? "public" : undefined} label={INVITE_STATUS_LABELS[inv.status]} />
                  {inv.usedBy && <Muted component="span"> {displayName(inv.usedBy)}</Muted>}
                </TableCell>
                <TableCell align="right">
                  {inv.status === "active" && (
                    <Button
                      variant="text"
                      color="error"
                      disabled={revoke.isPending}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: "この招待リンクを無効にしますか？",
                          body: "無効にしたリンクでは、誰も参加できなくなります。",
                          confirmLabel: "無効にする",
                          cancelLabel: "そのままにする",
                          danger: true,
                        });
                        if (ok) revoke.mutate(inv.id);
                      }}
                    >
                      無効にする
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
