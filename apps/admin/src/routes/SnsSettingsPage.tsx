import { Check, CircleCheck, TriangleAlert } from "lucide-react";
import Alert, { type AlertProps } from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X_POST_MAX_WEIGHT, xPostWeight, xProfileUrl, type SnsAccount, type SnsStatus, type XConnectResult } from "@wiki/shared";
import { useEffect, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpTip } from "../components/HelpTip";
import { Mono, Muted, Row, Section, SkeletonSection } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useWiki } from "../lib/wiki";
import { ExternalSite } from "./SettingsPage";

const textSx = { maxWidth: 680 } as const;

/** サーバーの設定の案内（オーナーが読む「i」の中身）。環境変数の名前は、画面の本文ではなくここにだけ置く。 */
const X_SERVER_SETUP =
  "サーバーを運用するオーナー向け：X の開発者アプリの Client ID・Client Secret と、トークンを保管するための鍵を、API のシークレットに登録します（X_CLIENT_ID・X_CLIENT_SECRET・SNS_TOKEN_KEY）。手順は、リポジトリの README の「SNS 連携」にあります。";

/** 連携できない（サーバーの設定が足りない）ときの案内。本文は読む人の言葉にして、くわしい手順は「i」に置く。 */
function ServerSetupAlert({ children }: { children: string }) {
  return (
    <Alert severity="info" sx={textSx}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexWrap: "wrap" }}>
        {children}
        <HelpTip about="サーバーの設定">{X_SERVER_SETUP}</HelpTip>
      </Box>
    </Alert>
  );
}

/** X の認可の画面から戻ってきたときに出す文。 */
export function xConnectResultMessage(result: XConnectResult, account: SnsAccount | null): { severity: AlertProps["severity"]; text: string } {
  switch (result) {
    case "connected":
      return { severity: "success", text: account ? `X のアカウント（@${account.username}）と連携しました。` : "X のアカウントと連携しました。" };
    case "denied":
      return { severity: "info", text: "X の画面で許可されなかったため、連携していません。" };
    case "expired":
      return { severity: "error", text: "連携の手続きが時間切れになりました（10分まで）。もう一度「X と連携する」を押してください。" };
    case "forbidden":
      return { severity: "error", text: "連携できませんでした。X の画面にいる間に、ログインが切れたか、この wiki の管理者でなくなりました。ログインし直して、もう一度お試しください。" };
    case "failed":
      return {
        severity: "error",
        text: "X から連携の許可を受け取れませんでした。もう一度「X と連携する」を押してください。続くときは、X の開発者アプリの設定（コールバック URL と Client Secret）を確かめてください。",
      };
  }
}

/** テスト投稿の文面の確かめ。何が違うかと、直し方を返す。 */
export function postTextProblem(text: string): string | null {
  if (text.trim() === "") return "ポストする文面を入れてください。";
  const over = xPostWeight(text.trim()) - X_POST_MAX_WEIGHT;
  if (over > 0) return `長すぎます。全角で ${Math.ceil(over / 2)} 文字ぶん（半角なら ${over} 文字ぶん）減らしてください。`;
  return null;
}

/** テスト投稿の文面の初めの値。同じ文面を続けてポストすると X に断られるので、日時を入れる。 */
export function defaultTestPostText(wikiName: string, now = new Date()): string {
  return `「${wikiName}」と X の連携のテストです（${formatDateTime(now.toISOString())}）。`;
}

/**
 * 「設定」の「SNS」タブ（`/w/{key}/settings/sns`）：wiki ごとの SNS 連携（いまは X だけ）。wiki の管理者だけ。
 * `result`：X の認可の画面から戻ってきたときの結果（URL の `?x=`）。読んだら `onResultRead` で URL から外す。
 */
export function SnsSettingsPage({ result, onResultRead }: { result?: XConnectResult; onResultRead: () => void }) {
  const { wiki, role } = useWiki();
  const status = useQuery({ queryKey: ["sns"], queryFn: api.snsStatus, enabled: role === "admin" });
  // 再読み込みで同じ結果を出し直さないよう、結果は URL から外して、この画面で持つ
  const [shown, setShown] = useState<XConnectResult | null>(result ?? null);
  useEffect(() => {
    if (!result) return;
    setShown(result);
    onResultRead();
  }, [result, onResultRead]);

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2">
          SNS
        </Typography>
        <Muted sx={textSx}>
          「{wiki.name}」の SNS アカウントをつなぎます。つないだアカウントには、この管理画面からポストできます。wiki ごとに、別のアカウントをつなげます。
        </Muted>
      </Section>
      {role !== "admin" ? (
        <Alert severity="info">SNS の連携は、この wiki の管理者だけが行えます。</Alert>
      ) : status.error ? (
        <Alert severity="error">{errorMessage(status.error)}</Alert>
      ) : !status.data ? (
        <SkeletonSection lines={3} />
      ) : (
        <XSection x={status.data.x} result={shown} onResultClose={() => setShown(null)} />
      )}
    </Stack>
  );
}

function XSection({ x, result, onResultClose }: { x: SnsStatus["x"]; result: XConnectResult | null; onResultClose: () => void }) {
  const connect = useMutation({
    mutationFn: api.connectX,
    // X の認可の画面へ移る。戻ってくるまで、ボタンは押せないままにする
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const connecting = connect.isPending || connect.isSuccess;
  const message = result && xConnectResultMessage(result, x.account);
  const startConnect = () => {
    onResultClose();
    connect.mutate();
  };

  return (
    <Section>
      <Row sx={{ mb: 0.5 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          X
        </Typography>
        <Muted component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: x.account ? "success.main" : "text.secondary" }}>
          {/* 連携しているかは、色だけでなく印と文字でも示す */}
          {x.account && <Check size={16} />}
          {x.account ? "連携中" : "未連携"}
        </Muted>
      </Row>

      {message && (
        <Alert severity={message.severity} onClose={onResultClose} sx={{ ...textSx, my: 1 }}>
          {message.text}
        </Alert>
      )}

      {x.account ? (
        <Connected account={x.account} available={x.available} connecting={connecting} onReconnect={startConnect} />
      ) : !x.available ? (
        <ServerSetupAlert>まだ X とつないでいません。つなぐにはサーバーの設定が要るので、この wiki のオーナーに頼んでください。</ServerSetupAlert>
      ) : (
        <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Muted sx={textSx}>
            「X と連携する」を押すと、X の画面に移ります。つなぎたいアカウントでログインしていることを確かめてから、許可してください。許可すると、この wiki
            は、そのアカウントでのポストと、アカウント名の確認ができるようになります。パスワードは、この管理画面には渡りません。
          </Muted>
          <Button variant="contained" disabled={connecting} onClick={startConnect}>
            {connecting ? "X の画面に移っています…" : "X と連携する"}
          </Button>
        </Stack>
      )}
      {connect.error && (
        <Alert severity="error" sx={{ ...textSx, mt: 1.5 }}>
          {errorMessage(connect.error)}
        </Alert>
      )}
    </Section>
  );
}

function Connected({ account, available, connecting, onReconnect }: { account: SnsAccount; available: boolean; connecting: boolean; onReconnect: () => void }) {
  const qc = useQueryClient();
  const disconnect = useMutation({
    mutationFn: api.disconnectX,
    onSuccess: (after) => qc.setQueryData(["sns"], after),
  });
  const askDisconnect = async () => {
    const ok = await confirmDialog({
      title: `@${account.username} との連携を解除しますか？`,
      body: "この wiki から、このアカウントにポストできなくなります。これまでのポストは消えません。あとから、もう一度連携できます。",
      confirmLabel: "連携を解除する",
      cancelLabel: "連携したままにする",
      danger: true,
    });
    if (ok) disconnect.mutate();
  };

  return (
    <Stack spacing={0}>
      <Box sx={{ mt: 0.5 }}>
        <Muted>連携しているアカウント</Muted>
        <Row>
          <Typography sx={{ fontWeight: 600 }}>{account.displayName}</Typography>
          <ExternalSite href={xProfileUrl(account.username)}>
            <Mono>@{account.username}</Mono>
          </ExternalSite>
        </Row>
        <Muted sx={{ mt: 0.5 }}>
          {account.connectedBy} さんが {formatDateTime(account.connectedAt)} に連携しました。
        </Muted>
      </Box>

      {available ? (
        <TestPost account={account} connecting={connecting} onReconnect={onReconnect} />
      ) : (
        <Box sx={{ mt: 2 }}>
          <ServerSetupAlert>サーバーの設定が足りないため、いまはポストできません。連携の解除はできます。直すには、この wiki のオーナーに頼んでください。</ServerSetupAlert>
        </Box>
      )}

      {/* 連携の解除は、ほかの操作から離して置く */}
      <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
        <Typography component="h4" sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>
          連携の解除
        </Typography>
        <Muted sx={textSx}>解除すると、この wiki からこのアカウントにポストできなくなります。これまでのポストは消えません。</Muted>
        <Stack spacing={1} sx={{ mt: 1.5, alignItems: "flex-start" }}>
          <Button variant="outlined" color="error" disabled={disconnect.isPending} onClick={() => void askDisconnect()}>
            {disconnect.isPending ? "解除しています…" : "連携を解除する"}
          </Button>
          {disconnect.error && (
            <Alert severity="error" sx={textSx}>
              {errorMessage(disconnect.error)}
            </Alert>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

/** テスト投稿：つないだアカウントに、実際に1件ポストして、連携が働いているかを確かめる。 */
function TestPost({ account, connecting, onReconnect }: { account: SnsAccount; connecting: boolean; onReconnect: () => void }) {
  const { wiki } = useWiki();
  const [text, setText] = useState(() => defaultTestPostText(wiki.name));
  const post = useMutation({ mutationFn: (value: string) => api.testPostX(value) });
  const weight = xPostWeight(text.trim());
  // 長すぎることは打っている間も出す。空であることは、押したときに出す
  const [emptyProblem, setEmptyProblem] = useState(false);
  const problem = weight > X_POST_MAX_WEIGHT || emptyProblem ? postTextProblem(text) : null;
  const reauth = post.error instanceof ApiError && post.error.code === "x_reauth_required";

  const submit = async () => {
    if (postTextProblem(text)) {
      setEmptyProblem(true);
      return;
    }
    const ok = await confirmDialog({
      title: `@${account.username} にポストしますか？`,
      body: "X に実際に投稿され、フォロワーにも見えます。ポストしたあとは、X の側で消せます。",
      confirmLabel: "ポストする",
      cancelLabel: "ポストしない",
    });
    if (ok) post.mutate(text.trim());
  };

  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
      <Typography component="h4" sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>
        テスト投稿
      </Typography>
      <Muted sx={textSx}>
        下の文面を <Mono>@{account.username}</Mono> に実際にポストして、連携が働いているかを確かめます。フォロワーにも見えます。1ポストは、全角で140文字（半角なら280文字）までです。
      </Muted>
      <TextField
        label="ポストする文面"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEmptyProblem(false);
          post.reset();
        }}
        multiline
        minRows={3}
        error={problem !== null}
        helperText={problem ?? `${weight} / ${X_POST_MAX_WEIGHT}（半角は1、全角は2と数えます）`}
        slotProps={{ inputLabel: { shrink: true }, formHelperText: { role: problem ? "alert" : undefined } }}
        sx={{ mt: 2, width: "100%", maxWidth: 680 }}
      />
      {/* 結果は、押したボタンのそばに出す */}
      <Stack spacing={1} sx={{ mt: 1.5, alignItems: "flex-start" }}>
        <Button variant="outlined" disabled={post.isPending || weight > X_POST_MAX_WEIGHT} onClick={() => void submit()}>
          {post.isPending ? "ポストしています…" : "テスト投稿する"}
        </Button>
        {post.data && !post.isPending && (
          <Alert severity="success" icon={<CircleCheck size={20} />} sx={textSx}>
            ポストしました。連携は働いています。 <ExternalSite href={post.data.url}>ポストを X で見る</ExternalSite>
          </Alert>
        )}
        {post.error && (
          <Alert
            severity="error"
            icon={<TriangleAlert size={20} />}
            sx={textSx}
            action={
              reauth ? (
                <Button color="inherit" size="small" disabled={connecting} onClick={onReconnect}>
                  X と連携し直す
                </Button>
              ) : undefined
            }
          >
            {errorMessage(post.error)}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
