import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { WIKI_ROLE_LABELS, type InviteInfo, type InviteStatus } from "@wiki/shared";
import { WikiIcon } from "../components/WikiIcon";
import { Muted, RouterLink, Section } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Center, Loading } from "./Layout";

/** 使えないリンクの理由。 */
const UNUSABLE: Record<Exclude<InviteStatus, "active">, string> = {
  used: "この招待リンクは、すでに使われています。",
  expired: "この招待リンクは、期限が切れています。",
  revoked: "この招待リンクは、管理者が無効にしました。",
};

/**
 * `/invite/{token}`：招待リンクを開いた人に、wiki の名前・ロール・期限を出し、参加させる。
 * ログインしていなくても開ける（ログインは参加のボタンから行い、終わるとそのまま参加する）。
 */
export function InvitePage({ token }: { token: string }) {
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.inviteInfo(token), retry: false });

  if (info.isPending) return <Loading />;
  if (info.error) {
    const missing = info.error instanceof ApiError && info.error.status === 404;
    return (
      <Frame title="招待リンクを使えません">
        <Alert severity="error">{missing ? "この招待リンクは見つかりません。URL が途中で切れていないか確かめてください。" : errorMessage(info.error)}</Alert>
        {missing && <Muted>管理者に新しいリンクを頼んでください。</Muted>}
      </Frame>
    );
  }
  return <InviteBody token={token} info={info.data} />;
}

function InviteBody({ token, info }: { token: string; info: InviteInfo }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const join = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: async (res) => {
      // 入れる wiki が変わったので、ログインの確認と wiki の一覧を読み直す
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      await navigate({ to: "/w/$wikiKey", params: { wikiKey: res.wikiKey } });
    },
  });

  const wikiName = (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", justifyContent: "center" }}>
      <WikiIcon wiki={info.wiki} size={36} />
      <Typography variant="h6" component="p" sx={{ fontWeight: 600 }}>
        {info.wiki.name}
      </Typography>
    </Stack>
  );

  if (info.alreadyMember) {
    return (
      <Frame title="すでに参加しています">
        {wikiName}
        <Muted>この wiki のメンバーなので、招待リンクは使わずに残してあります。ロールも変わりません。</Muted>
        <RouterLink to="/w/$wikiKey" params={{ wikiKey: info.wiki.key }}>
          wiki を開く
        </RouterLink>
      </Frame>
    );
  }

  if (info.status !== "active") {
    return (
      <Frame title="招待リンクを使えません">
        {wikiName}
        <Alert severity="warning">{UNUSABLE[info.status]}</Alert>
        <Muted>管理者に新しいリンクを頼んでください。</Muted>
      </Frame>
    );
  }

  return (
    <Frame title="wiki に招待されています">
      {wikiName}
      <Typography variant="body2">
        <strong>{WIKI_ROLE_LABELS[info.role]}</strong>として参加します（期限 {formatDateTime(info.expiresAt)}）
      </Typography>
      {join.error && <Alert severity="error">{errorMessage(join.error)}</Alert>}
      {info.viewerEmail ? (
        <>
          <Button variant="contained" size="medium" disabled={join.isPending} onClick={() => join.mutate()}>
            参加する
          </Button>
          <Muted>{info.viewerEmail} として参加します。</Muted>
        </>
      ) : (
        <Button variant="contained" size="medium" href={`/api/auth/google/login?invite=${encodeURIComponent(token)}`}>
          Google でログインして参加する
        </Button>
      )}
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Center>
      <Section sx={{ width: "100%", maxWidth: 440, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="h5" component="h1">
            {title}
          </Typography>
          {children}
        </Stack>
      </Section>
    </Center>
  );
}
