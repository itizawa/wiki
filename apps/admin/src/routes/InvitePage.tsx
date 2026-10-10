import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { WIKI_ROLE_LABELS, type InviteStatus } from "@wiki/shared";
import { Muted, RouterLink, Section } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Center, Loading, SwitchAccountButton } from "./Layout";

const UNUSABLE: Record<Exclude<InviteStatus, "active">, string> = {
  used: "この招待リンクは、すでに使われています。",
  expired: "この招待リンクは、期限が切れています。",
  revoked: "この招待リンクは、無効になっています。",
};

/**
 * `/invite/{token}`：招待リンクを開いたときの画面。ログインしていなくても開ける。
 * wiki の名前・ロール・期限を出し、ログインのうえで参加してもらう。
 */
export function InvitePage({ token }: { token: string }) {
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => api.invitePreview(token), retry: false });
  // ログインしているか（していなければ 401）
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const signedIn = me.isSuccess;
  const wikis = useQuery({ queryKey: ["wikis"], queryFn: api.listWikis, enabled: signedIn });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const join = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      if (!res.alreadyMember) await navigate({ to: "/w/$wikiKey", params: { wikiKey: res.wikiKey } });
    },
  });

  if (preview.isPending || me.isPending || (signedIn && wikis.isPending)) return <Loading />;

  const loginUrl = `/api/auth/google/login?invite=${encodeURIComponent(token)}`;
  let body;
  if (preview.error) {
    body =
      preview.error instanceof ApiError && preview.error.status === 404 ? (
        <Alert severity="error">この招待リンクは見つかりません。URL が途中で切れていないか確かめてください。</Alert>
      ) : (
        <Alert severity="error">{errorMessage(preview.error)}</Alert>
      );
  } else {
    const invite = preview.data;
    const member = wikis.data?.wikis.find((w) => w.key === invite.wiki.key);
    body = (
      <>
        <Typography variant="h5" component="h1">
          「{invite.wiki.name}」に招待されています
        </Typography>
        <Muted>
          ロール：{WIKI_ROLE_LABELS[invite.role]}
          {invite.status === "active" && <>・期限：{formatDateTime(invite.expiresAt)}</>}
        </Muted>
        {member || join.data?.alreadyMember ? (
          <>
            <Alert severity="info" sx={{ textAlign: "left" }}>
              すでに参加しています（{WIKI_ROLE_LABELS[member?.role ?? invite.role]}）。この招待リンクは使っていません。
            </Alert>
            <RouterLink to="/w/$wikiKey" params={{ wikiKey: invite.wiki.key }}>
              「{invite.wiki.name}」を開く
            </RouterLink>
          </>
        ) : invite.status !== "active" ? (
          <Alert severity="warning" sx={{ textAlign: "left" }}>
            {UNUSABLE[invite.status]}管理者に新しいリンクを頼んでください。
          </Alert>
        ) : signedIn ? (
          <>
            {join.error && <Alert severity="error">{joinError(join.error)}</Alert>}
            <Button variant="contained" size="medium" disabled={join.isPending} onClick={() => join.mutate()}>
              参加する
            </Button>
            <Muted>
              {me.data.email} として参加します。
            </Muted>
            <SwitchAccountButton next={loginUrl} />
          </>
        ) : (
          <Button variant="contained" size="medium" href={loginUrl}>
            Google でログインして参加する
          </Button>
        )}
      </>
    );
  }

  return (
    <Center>
      <Section sx={{ maxWidth: 440, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          {body}
        </Stack>
      </Section>
    </Center>
  );
}

function joinError(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = UNUSABLE[err.code.replace(/^invite_/, "") as keyof typeof UNUSABLE];
    if (reason) return `${reason}管理者に新しいリンクを頼んでください。`;
  }
  return errorMessage(err);
}
