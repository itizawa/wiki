import { Copy } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { INVITE_TTL_DAYS, WIKI_ROLE_LABELS, WIKI_ROLES, type Invite, type InviteStatus, type Member, type WikiRole } from "@wiki/shared";
import { useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { Tooltip } from "../components/Tooltip";
import { Field, Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useRefreshWikis, useWiki } from "../lib/wiki";
import { useSession } from "./Layout";

const STATUS_LABELS: Record<InviteStatus, { label: string; color: "success" | "default" | "warning" }> = {
  active: { label: "使える", color: "success" },
  used: { label: "使用済み", color: "default" },
  expired: { label: "期限切れ", color: "warning" },
  revoked: { label: "無効", color: "default" },
};

/** 一覧の行の高さ（読み込み中の行も、この高さで出す） */
const MEMBER_ROW_HEIGHT = 64;
const INVITE_ROW_HEIGHT = 49;

/** メンバー：一覧（メンバーなら誰でも見られる）、ロールの変更・削除と招待リンク（管理者だけ）、自分で抜ける。 */
export function MembersPage() {
  const { wiki, role } = useWiki();
  const isAdmin = role === "admin";
  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help={
            <>
              「{wiki.name}」に入れる人です。編集者はページの作成・編集・公開まで、管理者はそれに加えて招待・メンバーの管理ができます。オーナーは一覧に出なくても、すべての wiki に管理者として入れます。
            </>
          }
        >
          メンバー
        </HelpHeading>
      </Section>
      <Members isAdmin={isAdmin} />
      {isAdmin && <Invites />}
    </Stack>
  );
}

function Members({ isAdmin }: { isAdmin: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const refreshWikis = useRefreshWikis();
  const navigate = useNavigate();
  const members = useQuery({ queryKey: ["members"], queryFn: api.listMembers });
  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: WikiRole }) => api.changeRole(input.userId, input.role),
    onSuccess: (res, input) => {
      qc.setQueryData(["members"], res);
      // 自分のロールは wiki の一覧から読んでいるので、読み直す
      if (input.userId === session.id) void refreshWikis();
    },
  });
  const remove = useMutation({
    mutationFn: (member: Member) => api.removeMember(member.userId),
    onSuccess: async (_res, member) => {
      if (member.userId === session.id) {
        // 自分で抜けたら、この wiki はもう開けない
        // wiki の一覧は、wiki ごとの入れ物（qc）の外にある
        await refreshWikis();
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

  const columns: DataListColumn<Member>[] = [
    {
      key: "name",
      header: "名前 / メールアドレス",
      width: "minmax(200px, 1fr)",
      render: (m) => (
        <Box>
          <Box sx={{ fontWeight: 600 }}>
            {m.name ?? m.email}
            {m.userId === session.id && <Chip size="small" label="自分" sx={{ ml: 1 }} />}
            {m.isOwner && <Chip size="small" label="オーナー" variant="outlined" sx={{ ml: 1 }} />}
          </Box>
          {m.name && <Muted>{m.email}</Muted>}
        </Box>
      ),
    },
    {
      key: "role",
      header: "ロール",
      narrow: "stack",
      render: (m) => {
        // メンバーの管理者が0人になる操作は止める（オーナーは数えない）
        const lastAdmin = m.role === "admin" && admins <= 1;
        if (!isAdmin) return WIKI_ROLE_LABELS[m.role];
        return (
          <Box>
            <Field
              select
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
            </Field>
            {lastAdmin && <Muted sx={{ mt: 0.5, whiteSpace: "nowrap" }}>最後の管理者なので、変えられません</Muted>}
          </Box>
        );
      },
    },
    { key: "createdAt", header: "参加した日", narrow: "hide", sx: { whiteSpace: "nowrap" }, render: (m) => formatDateTime(m.createdAt) },
    {
      key: "actions",
      header: "操作",
      narrow: "stack",
      width: "max-content",
      render: (m) => {
        const self = m.userId === session.id;
        const lastAdmin = m.role === "admin" && admins <= 1;
        if (!self && !isAdmin) return null;
        return (
          <Tooltip title={lastAdmin ? "最後の管理者です。先にほかのメンバーを管理者にしてください" : ""}>
            {/* 無効のボタンにもツールチップを出すため、span で包む */}
            <span>
              <Button variant="outlined" color="error" disabled={lastAdmin || remove.isPending} onClick={() => confirmRemove(m)} sx={{ whiteSpace: "nowrap" }}>
                {self ? "抜ける" : "外す"}
              </Button>
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Section>
      <Typography variant="h6" component="h3" gutterBottom>
        メンバーの一覧
      </Typography>
      {/* 読み込みのエラーは、DataList が出す */}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage(error)}
        </Alert>
      )}
      <DataList
        label="メンバーの一覧"
        columns={columns}
        rows={members.data ? list : undefined}
        rowKey={(m) => m.userId}
        error={members.error}
        empty="メンバーはいません。オーナーだけが入れます。"
        rowHeight={MEMBER_ROW_HEIGHT}
        skeletonRows={3}
      />
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

  const inviteColumns: DataListColumn<Invite>[] = [
    { key: "role", header: "ロール", render: (i) => WIKI_ROLE_LABELS[i.role] },
    { key: "createdBy", header: "発行した人", narrow: "hide", width: "minmax(160px, 1fr)", render: (i) => i.createdBy.name ?? i.createdBy.email },
    { key: "expiresAt", header: "期限", narrow: "hide", sx: { whiteSpace: "nowrap" }, render: (i) => formatDateTime(i.expiresAt) },
    {
      key: "status",
      header: "状態",
      render: (i) => (
        <Box>
          <Chip size="small" label={STATUS_LABELS[i.status].label} color={STATUS_LABELS[i.status].color} />
          {i.usedBy && <Muted component="span">　{i.usedBy.name ?? i.usedBy.email} が参加</Muted>}
        </Box>
      ),
    },
    {
      key: "actions",
      header: "操作",
      narrow: "stack",
      width: "max-content",
      render: (i) =>
        i.status === "active" && (
          <Button variant="text" color="error" disabled={revoke.isPending} onClick={() => confirmRevoke(i)} sx={{ whiteSpace: "nowrap" }}>
            無効にする
          </Button>
        ),
    },
  ];

  return (
    <Section>
      <HelpHeading variant="h6" component="h3" help="メールは送りません。発行したリンクを、参加する人に自分で伝えてください。">
        招待リンク
      </HelpHeading>
      {/* 条件（人数と期限）は、発行する前から出しておく */}
      <Muted sx={{ mb: 1.5 }}>
        1つのリンクで1人が参加できます。期限は{INVITE_TTL_DAYS}日です。
      </Muted>
      <Row>
        <Field select label="参加する人のロール" value={role} onChange={(e) => setRole(e.target.value as WikiRole)} sx={{ minWidth: 180 }}>
          {WIKI_ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {WIKI_ROLE_LABELS[r]}
            </MenuItem>
          ))}
        </Field>
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
          {/* sm 未満は、URL を折り返して全部見せ、「コピー」をその下に置く。sm 以上は、欄とボタンを横に並べる */}
          <Box sx={{ display: { xs: "block", sm: "none" } }}>
            <Typography component="div" sx={{ fontFamily: "monospace", fontSize: 13, overflowWrap: "anywhere", mb: 1 }}>
              {issued.url}
            </Typography>
            <Button variant="outlined" startIcon={<Copy size={16} />} onClick={copy}>
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </Box>
          <Row sx={{ flexWrap: "nowrap", display: { xs: "none", sm: "flex" } }}>
            <Field
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

      <Typography variant="subtitle2" component="h4" sx={{ mt: 2.5, mb: 0.5 }}>
        発行したリンク
      </Typography>
      {revoke.error && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
      <DataList
        label="発行したリンク"
        columns={inviteColumns}
        rows={invites.data?.invites}
        rowKey={(i) => i.id}
        error={invites.error}
        empty="まだ発行していません。"
        rowHeight={INVITE_ROW_HEIGHT}
        skeletonRows={2}
      />
    </Section>
  );
}
