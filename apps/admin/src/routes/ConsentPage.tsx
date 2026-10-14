import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { OAUTH_SCOPES, type OAuthScope } from "@wiki/shared";
import { useState } from "react";
import { Mono, Muted, RouterLink, Section, SkeletonSection } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { Center, useSession } from "./Layout";

/** 既定で許すスコープ。非公開のページを外へ送るかどうかは、毎回その人に選んでもらう */
const DEFAULT_ON: OAuthScope[] = ["wiki.read", "wiki.write", "wiki.suggest"];

export const CONSENT_MISSING_HEADING = "接続の依頼が見つかりません";

/**
 * `/consent`：外部のアプリ（MCP クライアント）からの接続の依頼に、許可するかを決める画面。
 * `/oauth/authorize` が、確かめた依頼を署名して `request` に入れて送ってくる。
 */
export function ConsentPage() {
  const session = useSession();
  const request = new URLSearchParams(location.search).get("request") ?? "";
  // request が無いときは、API に問い合わせない
  const info = useQuery({ queryKey: ["oauth-request", request], queryFn: () => api.oauthRequest(request), retry: false, enabled: request !== "" });
  const [checked, setChecked] = useState<OAuthScope[] | null>(null);
  const scopes = checked ?? info.data?.scopes.filter((s) => DEFAULT_ON.includes(s)) ?? [];

  const decide = useMutation({
    mutationFn: (approve: boolean) => api.oauthDecide({ request, approve, scopes }),
    // アプリへ戻す（戻り先は、アプリの登録と完全に一致したものだけ）
    onSuccess: ({ redirectTo }) => location.assign(redirectTo),
  });

  if (request === "") {
    return (
      <Center>
        <Section sx={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
          <Stack spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="h5" component="h1">
              {CONSENT_MISSING_HEADING}
            </Typography>
            <Muted>接続するアプリから、もう一度つなぐ操作を始めてください。すでにつないだアプリは、下のリンクから確かめられます。</Muted>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 3 }} sx={{ alignItems: "center" }}>
              <RouterLink to="/connections">外部アプリ連携を開く</RouterLink>
              <RouterLink to="/">管理画面のトップへ</RouterLink>
            </Stack>
          </Stack>
        </Section>
      </Center>
    );
  }
  if (info.isPending) {
    // あとに出るのは中央のカードなので、同じ位置と幅のカードの形を出す
    return (
      <Center>
        <SkeletonSection lines={5} sx={{ maxWidth: 520, width: "100%" }} />
      </Center>
    );
  }
  if (info.error) {
    return (
      <Center>
        <Alert severity="error" sx={{ maxWidth: 480 }}>
          {errorMessage(info.error)}
          <br />
          接続の依頼は10分で切れます。アプリの側から、もう一度つなぎ直してください。
        </Alert>
      </Center>
    );
  }
  const { client } = info.data;
  const toggle = (scope: OAuthScope, on: boolean) => setChecked(on ? [...scopes, scope] : scopes.filter((s) => s !== scope));

  return (
    <Center>
      <Section sx={{ maxWidth: 520, width: "100%" }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5" component="h1">
              「{client.name}」に wiki の操作を許可しますか
            </Typography>
            <Muted sx={{ mt: 0.5 }}>
              {session.email} としてログインしています。許可すると、このアプリはあなたとして wiki を操作できます。
            </Muted>
          </Box>

          <Alert severity="warning">
            アプリの名前は、アプリ自身が名乗ったものです。つなぐ操作を始めたのが自分で、戻り先 <Mono>{client.redirectHost}</Mono>{" "}
            に心当たりがあるときだけ許可してください。
          </Alert>

          <Box>
            <Typography variant="subtitle1" component="h2">
              許可すること
            </Typography>
            <FormGroup>
              {info.data.scopes.map((scope) => (
                <FormControlLabel
                  key={scope}
                  control={
                    <Checkbox
                      checked={scopes.includes(scope)}
                      disabled={OAUTH_SCOPES[scope].required}
                      onChange={(e) => toggle(scope, e.target.checked)}
                    />
                  }
                  label={OAUTH_SCOPES[scope].label}
                />
              ))}
            </FormGroup>
            <Muted sx={{ mt: 0.5 }}>
              作ったページは非公開の下書きから始まります。許可は90日で切れ、「外部アプリ連携」からいつでも取り消せます。
            </Muted>
          </Box>

          {decide.error && <Alert severity="error">{errorMessage(decide.error)}</Alert>}
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button variant="outlined" disabled={decide.isPending || decide.isSuccess} onClick={() => decide.mutate(false)}>
              許可しない
            </Button>
            <Button variant="contained" disabled={decide.isPending || decide.isSuccess} onClick={() => decide.mutate(true)}>
              許可する
            </Button>
          </Stack>
          {decide.isSuccess && <Muted>アプリに戻っています…</Muted>}
        </Stack>
      </Section>
    </Center>
  );
}
