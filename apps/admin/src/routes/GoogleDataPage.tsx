import { Check } from "lucide-react";
import Alert, { type AlertProps } from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GOOGLE_DATA_FAILURE_MESSAGES,
  GOOGLE_DATA_SCOPES,
  gaPropertyIdSchema,
  searchConsoleSiteSchema,
  type GoogleDataConnectResult,
  type GoogleDataConnection,
  type GoogleDataFailure,
  type GoogleDataStatus,
  type WikiGoogleProperties,
} from "@wiki/shared";
import { useEffect, useState } from "react";
import { ConfirmHost, confirmDialog } from "../components/ConfirmDialog";
import { DataList, type ColumnLayout, type DataListColumn } from "../components/DataList";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Mono, Muted, Row, Section, SkeletonSection } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession } from "./Layout";
import { actionsRowSx } from "./WikisPage";

const KEY = ["google-data"];
const ROW_HEIGHT = 64;

/** サーバーの設定の案内（オーナーが読む「i」の中身）。環境変数の名前は、画面の本文ではなくここにだけ置く。 */
const SERVER_SETUP =
  "サーバーを運用するオーナー向け：ログインと同じ Google の OAuth クライアントに、リダイレクト URI（/api/auth/google-data/callback）とスコープを足し、トークンを保管するための鍵（GOOGLE_DATA_TOKEN_KEY）を API のシークレットに登録します。手順は、リポジトリの docs/operations.md の「Google 連携（Search Console・GA4）」にあります。";

export const googlePropertyColumnLayout = {
  wiki: { width: "minmax(120px, 1fr)" },
  searchConsole: { width: "minmax(180px, 1.5fr)" },
  ga: { width: "minmax(120px, 1fr)", narrow: "hide" },
  result: { width: "minmax(160px, 1.2fr)", narrow: "hide" },
  actions: { width: "max-content", narrow: "stack" },
} satisfies ColumnLayout;

/** Google の同意の画面から戻ってきたときに出す文。 */
export function googleConnectResultMessage(result: GoogleDataConnectResult, connection: GoogleDataConnection | null): { severity: AlertProps["severity"]; text: string } {
  switch (result) {
    case "connected":
      return { severity: "success", text: connection?.email ? `Google のアカウント（${connection.email}）につなぎました。下で、wiki ごとに読むプロパティを選んでください。` : "Google につなぎました。" };
    case "denied":
      return { severity: "info", text: "Google の画面で許可されなかったため、つないでいません。" };
    case "missing_scope":
      return { severity: "error", text: "Search Console と Google アナリティクスの両方を読む許可が要ります。もう一度「Google につなぐ」を押し、2つのチェックを入れたまま許可してください。" };
    case "expired":
      return { severity: "error", text: "手続きが時間切れになりました（10分まで）。もう一度「Google につなぐ」を押してください。" };
    case "forbidden":
      return { severity: "error", text: "つなげませんでした。Google の画面にいる間に、ログインが切れたか、オーナーでなくなりました。ログインし直して、もう一度お試しください。" };
    case "failed":
      return { severity: "error", text: "Google から許可を受け取れませんでした。もう一度「Google につなぐ」を押してください。続くときは、OAuth クライアントのリダイレクト URI を確かめてください。" };
  }
}

const failureText = (reason: GoogleDataFailure) => GOOGLE_DATA_FAILURE_MESSAGES[reason];

/**
 * 「全体の管理」の「Google」：オーナーが Google（Search Console・GA4 の読み取り）につなぎ、wiki ごとに読むプロパティを選ぶ。
 * 選んだ数字は、MCP の gsc_query・ga4_report で、その wiki の管理者として許可したアプリ（ワークフローの Routine など）が読む。
 */
export function GoogleDataPage({ result, onResultRead }: { result?: GoogleDataConnectResult; onResultRead: () => void }) {
  const session = useSession();
  const status = useQuery({ queryKey: KEY, queryFn: api.googleDataStatus, enabled: session.isOwner });
  // 戻ってきた結果は一度だけ出し、URL からは消す（再読み込みで出し直さない）
  const [shown, setShown] = useState<GoogleDataConnectResult | null>(result ?? null);
  useEffect(() => {
    if (result) {
      setShown(result);
      onResultRead();
    }
  }, [result, onResultRead]);

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      <HelpHeading
        variant="h6"
        component="h2"
        help="Google のアカウントにつなぐと、wiki ごとに選んだ Search Console と Google アナリティクス（GA4）の数字を、外部のアプリ（MCP）の gsc_query・ga4_report で読めるようになります。読めるのは、その wiki の管理者として許可したアプリ（ワークフローから呼ぶ Routine など）だけです。Google の鍵やトークンは、アプリにも画面にも渡しません。"
      >
        Google
      </HelpHeading>
      {!session.isOwner ? (
        <Alert severity="info">Google との接続は、オーナーだけが行えます。</Alert>
      ) : status.error ? (
        <Alert severity="error">{errorMessage(status.error)}</Alert>
      ) : !status.data ? (
        <SkeletonSection lines={3} />
      ) : (
        <>
          <ConnectionSection status={status.data} result={shown} onResultClose={() => setShown(null)} />
          {status.data.connection && <PropertiesSection wikis={status.data.wikis} />}
        </>
      )}
    </Stack>
  );
}

function ConnectionSection({ status, result, onResultClose }: { status: GoogleDataStatus; result: GoogleDataConnectResult | null; onResultClose: () => void }) {
  const qc = useQueryClient();
  const { connection, available } = status;
  const connect = useMutation({
    mutationFn: api.connectGoogleData,
    // Google の同意の画面へ移る。戻ってくるまで、ボタンは押せないままにする
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectGoogleData,
    onSuccess: (next) => qc.setQueryData(KEY, next),
  });
  const connecting = connect.isPending || connect.isSuccess;
  const message = result && googleConnectResultMessage(result, connection);
  const startConnect = () => {
    onResultClose();
    connect.mutate();
  };
  const askDisconnect = async () => {
    const ok = await confirmDialog({
      title: "Google との接続を外しますか？",
      body: "保存してあるトークンを Google でも無効にして消します。外している間、gsc_query・ga4_report は使えず、毎日のレポートは数字を取れません。wiki ごとに選んだプロパティは残ります。",
      confirmLabel: "接続を外す",
      cancelLabel: "外さずに戻る",
      danger: true,
    });
    if (ok) disconnect.mutate();
  };
  const missing = connection ? [GOOGLE_DATA_SCOPES.searchConsole, GOOGLE_DATA_SCOPES.analytics].filter((s) => !connection.scopes.includes(s)) : [];

  return (
    <Section>
      <Row sx={{ mb: 0.5 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          接続
        </Typography>
        <Muted component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: connection ? "success.main" : "text.secondary" }}>
          {/* つないでいるかは、色だけでなく印と文字でも示す */}
          {connection && <Check size={16} />}
          {connection ? "接続中" : "未接続"}
        </Muted>
      </Row>
      <Stack spacing={1.5} sx={{ maxWidth: 720 }}>
        {message && (
          <Alert severity={message.severity} onClose={onResultClose}>
            {message.text}
          </Alert>
        )}
        {!available && (
          <Alert severity="info">
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexWrap: "wrap" }}>
              サーバーの設定が足りないため、Google につなげません。
              <HelpTip about="サーバーの設定">{SERVER_SETUP}</HelpTip>
            </Box>
          </Alert>
        )}
        {connection ? (
          <>
            <Box>
              <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{connection.email ?? "（メールアドレス不明）"}</Typography>
              <Muted>
                {connection.connectedBy} さんが {formatDateTime(connection.connectedAt)} につなぎました。読み取りだけ（Search Console・Google アナリティクス）を許可しています。
              </Muted>
            </Box>
            <Box>
              <Muted>最後に数字を取れた日時：{connection.lastSuccessAt ? formatDateTime(connection.lastSuccessAt) : "まだありません"}</Muted>
            </Box>
            {connection.lastFailureReason && connection.lastFailureAt && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" disabled={!available || connecting} onClick={startConnect}>
                    つなぎ直す
                  </Button>
                }
              >
                {formatDateTime(connection.lastFailureAt)} に取れませんでした：{failureText(connection.lastFailureReason)}
              </Alert>
            )}
            {missing.length > 0 && <Alert severity="warning">許可が足りません。「つなぎ直す」で、Search Console と Google アナリティクスの両方を許可してください。</Alert>}
            <Row sx={actionsRowSx}>
              <Button variant="outlined" disabled={!available || connecting} onClick={startConnect}>
                {connecting ? "Google の画面に移っています…" : "つなぎ直す"}
              </Button>
              <Button variant="outlined" color="error" disabled={disconnect.isPending} onClick={() => void askDisconnect()} sx={{ ml: { md: 3 } }}>
                {disconnect.isPending ? "外しています…" : "接続を外す"}
              </Button>
            </Row>
          </>
        ) : (
          <>
            <Muted>Search Console と Google アナリティクスを読めるアカウントでつないでください。求めるのは読み取りの許可だけです。</Muted>
            <Box>
              <Button variant="contained" disabled={!available || connecting} onClick={startConnect}>
                {connecting ? "Google の画面に移っています…" : "Google につなぐ"}
              </Button>
            </Box>
          </>
        )}
        {connect.error && <Alert severity="error">{errorMessage(connect.error)}</Alert>}
        {disconnect.error && <Alert severity="error">{errorMessage(disconnect.error)}</Alert>}
      </Stack>
    </Section>
  );
}

function PropertiesSection({ wikis }: { wikis: WikiGoogleProperties[] }) {
  const [editing, setEditing] = useState<WikiGoogleProperties | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const columns: DataListColumn<WikiGoogleProperties>[] = [
    {
      key: "wiki",
      header: "wiki",
      ...googlePropertyColumnLayout.wiki,
      render: (w) => (
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{w.name}</Box>
          <Muted sx={{ fontSize: 12 }}>{w.key}</Muted>
        </Box>
      ),
    },
    {
      key: "searchConsole",
      header: "Search Console",
      ...googlePropertyColumnLayout.searchConsole,
      render: (w) => (w.searchConsoleSite ? <Mono sx={{ fontSize: 13, wordBreak: "break-all" }}>{w.searchConsoleSite}</Mono> : <Muted>未設定</Muted>),
    },
    {
      key: "ga",
      header: "GA4",
      ...googlePropertyColumnLayout.ga,
      render: (w) => (w.gaPropertyId ? <Mono sx={{ fontSize: 13 }}>{w.gaPropertyId}</Mono> : <Muted>未設定</Muted>),
    },
    {
      key: "result",
      header: "最後の取得",
      ...googlePropertyColumnLayout.result,
      render: (w) => <LastResult wiki={w} />,
    },
    {
      key: "actions",
      header: "操作",
      ...googlePropertyColumnLayout.actions,
      render: (w) => (
        <Button variant="outlined" onClick={() => setEditing(w)} sx={{ whiteSpace: "nowrap" }}>
          変更
        </Button>
      ),
    },
  ];

  return (
    <Section>
      <Typography variant="subtitle1" component="h3" gutterBottom sx={{ fontWeight: 600 }}>
        wiki ごとのプロパティ
      </Typography>
      <Muted sx={{ mb: 1 }}>wiki ごとに、読む Search Console と GA4 のプロパティを選びます。MCP の道具は、ここで選んだプロパティだけを読みます。</Muted>
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
          {done}
        </Alert>
      )}
      <DataList label="wiki ごとのプロパティ" columns={columns} rows={wikis} rowKey={(w) => w.key} empty="使用中の wiki がありません。" rowHeight={ROW_HEIGHT} skeletonRows={2} />
      {editing && (
        <PropertiesDialog
          wiki={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setDone(`「${editing.name}」のプロパティを保存しました。`);
            setEditing(null);
          }}
        />
      )}
    </Section>
  );
}

function LastResult({ wiki }: { wiki: WikiGoogleProperties }) {
  if (wiki.lastFailureReason && wiki.lastFailureAt && (!wiki.lastSuccessAt || wiki.lastFailureAt > wiki.lastSuccessAt)) {
    return (
      <Box sx={{ minWidth: 0 }}>
        <Muted sx={{ fontSize: 13, color: "error.main" }}>{formatDateTime(wiki.lastFailureAt)} に失敗</Muted>
        <Muted sx={{ fontSize: 12 }}>{failureText(wiki.lastFailureReason)}</Muted>
      </Box>
    );
  }
  return <Muted sx={{ fontSize: 13 }}>{wiki.lastSuccessAt ? `${formatDateTime(wiki.lastSuccessAt)} に取得` : "まだ取得していません"}</Muted>;
}

/** プロパティを選ぶダイアログ。候補はつないだアカウントで読めるもの。候補に無い値も、形が合えば入れられる */
function PropertiesDialog({ wiki, onClose, onDone }: { wiki: WikiGoogleProperties; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: [...KEY, "properties"], queryFn: api.googleDataProperties });
  const [site, setSite] = useState(wiki.searchConsoleSite ?? "");
  const [ga, setGa] = useState(wiki.gaPropertyId ?? "");
  const siteOk = site.trim() === "" || searchConsoleSiteSchema.safeParse(site).success;
  const gaOk = ga.trim() === "" || gaPropertyIdSchema.safeParse(ga).success;
  const save = useMutation({
    mutationFn: () => api.setWikiGoogleProperties(wiki.key, { searchConsoleSite: site.trim() || null, gaPropertyId: ga.trim() || null }),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      onDone();
    },
  });
  const siteOptions = options.data?.searchConsoleSites.map((s) => s.siteUrl) ?? [];
  const gaOptions = options.data?.gaProperties ?? [];
  const gaLabel = (id: string) => {
    const p = gaOptions.find((o) => o.propertyId === id);
    return p ? `${p.displayName}（${p.accountName}）` : id;
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="google-properties-title">
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (siteOk && gaOk && !save.isPending) save.mutate();
        }}
      >
        <DialogTitle id="google-properties-title">「{wiki.name}」のプロパティ</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {save.error && (
              <Alert severity="error" role="alert">
                {errorMessage(save.error)}
              </Alert>
            )}
            {options.error && <Alert severity="warning">候補を読めませんでした（{errorMessage(options.error)}）。値を直接入れることもできます。</Alert>}
            <Autocomplete
              freeSolo
              options={siteOptions}
              loading={options.isLoading}
              inputValue={site}
              onInputChange={(_, v) => {
                setSite(v);
                save.reset();
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search Console のプロパティ"
                  placeholder="sc-domain:example.com"
                  error={!siteOk}
                  helperText={siteOk ? "ドメイン（sc-domain:…）か URL プレフィックス（https://…/）。空なら読まない" : "sc-domain:example.com か https://example.com/ の形で入れてください"}
                />
              )}
            />
            <Autocomplete
              freeSolo
              options={gaOptions.map((o) => o.propertyId)}
              getOptionLabel={(id) => (typeof id === "string" ? id : "")}
              renderOption={(props, id) => (
                <li {...props} key={id}>
                  <Box>
                    <Box>{gaLabel(id)}</Box>
                    <Muted sx={{ fontSize: 12 }}>{id}</Muted>
                  </Box>
                </li>
              )}
              loading={options.isLoading}
              inputValue={ga}
              onInputChange={(_, v) => {
                setGa(v);
                save.reset();
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="GA4 のプロパティ ID"
                  placeholder="123456789"
                  error={!gaOk}
                  helperText={gaOk ? (ga && gaOptions.some((o) => o.propertyId === ga) ? gaLabel(ga) : "数字だけ（測定 ID の G- ではない）。空なら読まない") : "GA4 のプロパティ ID（数字だけ）を入れてください"}
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>保存せずに閉じる</Button>
          <Button type="submit" variant="contained" disabled={!siteOk || !gaOk || save.isPending}>
            {save.isPending ? "保存しています…" : "保存する"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
