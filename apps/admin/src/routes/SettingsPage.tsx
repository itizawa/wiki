import { Check, CircleCheck, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { extractSearchConsoleVerification, isGaMeasurementId, isSearchConsoleVerification, type GoogleConnection, type WikiSettings } from "@wiki/shared";
import { useEffect, useState, type ReactNode } from "react";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Mono, Muted, RouterLink, Row, SaveNotice, Section, SkeletonSection } from "../components/ui";
import { checkResultText, gaPropertyIdProblem, SERVICE_ACCOUNT_SECRET, type AnalyticsTarget } from "../lib/analytics";
import { api, ApiError, errorMessage } from "../lib/api";
import { screenLink, useWiki } from "../lib/wiki";

/** 測定 ID の欄に入れたものを、保存する形にそろえる（前後の空白を落とし、英字は大文字にする）。 */
export function normalizeGaMeasurementId(value: string): string {
  return value.trim().toUpperCase();
}

/** 測定 ID の欄の確かめ。空なら「連携しない」。何が違うかと、直し方を返す。 */
export function gaMeasurementIdProblem(value: string): string | null {
  const v = normalizeGaMeasurementId(value);
  if (v === "" || isGaMeasurementId(v)) return null;
  const start = "「G-」で始まる測定 ID を入れてください。";
  if (v.startsWith("UA-")) return `${start}「UA-」で始まる古い ID（ユニバーサルアナリティクス）は使えません。`;
  if (v.startsWith("GTM-")) return `${start}「GTM-」で始まる ID（Google タグマネージャー）は使えません。`;
  if (v.startsWith("AW-")) return `${start}「AW-」で始まる ID（Google 広告）は使えません。`;
  return `${start}「G-」のあとは、半角の英字と数字が4〜20文字です（例：G-XXXXXXXXXX）。`;
}

/** 確認用の値の欄の確かめ。タグごと貼られたものは、content の値を取り出してから確かめる。空なら「連携しない」。 */
export function searchConsoleVerificationProblem(value: string): string | null {
  const v = extractSearchConsoleVerification(value);
  if (v === "" || isSearchConsoleVerification(v)) return null;
  if (/^<meta\b/i.test(v)) return "タグから content の値を取り出せませんでした。サーチコンソールの「HTML タグ」に表示されたタグを、そのまま貼ってください。";
  if (/^[A-Za-z0-9_-]+$/.test(v)) return "値が長すぎます（100文字まで）。サーチコンソールの「HTML タグ」に表示されたタグを、そのまま貼ってください。";
  return "確認用の値に使えるのは、半角の英字・数字・「-」「_」だけです。サーチコンソールの「HTML タグ」に表示されたタグか、その content の値を貼ってください。";
}

/** 保存したあとに出す文。反映までの時間と、外したときにタグが消えることを伝える。 */
export function savedMessage(before: WikiSettings, after: WikiSettings): string {
  const siteChanged = after.gaMeasurementId !== before.gaMeasurementId || after.searchConsoleVerification !== before.searchConsoleVerification;
  // プロパティ ID は管理画面の「アクセス解析」だけが使う。公開サイトは変わらない
  const parts = [siteChanged ? "保存しました。公開サイトには数分で反映されます。" : "保存しました。"];
  if (after.gaPropertyId !== before.gaPropertyId) {
    parts.push(after.gaPropertyId ? "プロパティ ID は、下の「接続を確かめる」で、つながるかを確かめられます。" : "プロパティ ID を外しました。「アクセス解析」に、GA の数字は出なくなります。");
  }
  if (after.gaMeasurementId && after.gaMeasurementId !== before.gaMeasurementId) {
    parts.push("Google Analytics の画面に数字が出るまでは、数時間かかることがあります。");
  }
  const removed = [
    before.gaMeasurementId && !after.gaMeasurementId ? "Google Analytics" : null,
    before.searchConsoleVerification && !after.searchConsoleVerification ? "Google サーチコンソール" : null,
  ].filter((name) => name !== null);
  if (removed.length > 0) parts.push(`${removed.join("と")}の連携を外しました。次のビルドで、公開サイトからタグが消えます。`);
  return parts.join("");
}

const textSx = { maxWidth: 680 } as const;
const stepsSx = { m: 0, pl: 2.75, fontSize: "0.9rem", "& > li": { mb: 0.75 }, ...textSx } as const;

/** 「設定」の「連携」タブ（`/w/{key}/settings/integrations`）：公開サイトの外部サービスとの連携（Google Analytics・サーチコンソール）。 */
export function SettingsPage() {
  const { wiki, isOwner } = useWiki();
  const settings = useQuery({ queryKey: ["wiki-settings"], queryFn: api.getSettings });
  // Google へ足すサービスアカウント。取れなくても、設定の欄は出す
  const connection = useQuery({ queryKey: ["analytics-connection"], queryFn: api.analyticsConnection });

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help={
            <>
              「{wiki.name}」の公開サイト（{wiki.origin}）を Google のサービスとつなぎます。限定公開のページ（/u/...）には、どちらのタグも入れません（限定公開の URL を外へ送らないため）。
            </>
          }
        >
          連携
        </HelpHeading>
        {/* リンクは「i」の中では押せないので、外に出しておく */}
        <Muted sx={textSx}>
          つないだあとの数字は、<RouterLink {...screenLink("/w/$wikiKey/analytics")} underline="always">「アクセス解析」</RouterLink>で見られます。
        </Muted>
      </Section>

      {!isOwner && <Alert severity="info">変更はオーナーだけが行えます。いまの値は、下で見られます。</Alert>}
      {settings.error && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
      {/* 2つのまとまり（Google Analytics・サーチコンソール）の形 */}
      {settings.isPending && [0, 1].map((i) => <SkeletonSection key={i} lines={3} />)}
      {settings.data &&
        (isOwner ? (
          <SettingsForm origin={wiki.origin} saved={settings.data} connection={connection.data} />
        ) : (
          <ReadOnlySettings settings={settings.data} connection={connection.data} />
        ))}
    </Stack>
  );
}

function SettingsForm({ origin, saved, connection }: { origin: string; saved: WikiSettings; connection: GoogleConnection | undefined }) {
  const qc = useQueryClient();
  const [gaId, setGaId] = useState(saved.gaMeasurementId ?? "");
  const [propertyId, setPropertyId] = useState(saved.gaPropertyId ?? "");
  const [propertyProblem, setPropertyProblem] = useState<string | null>(null);
  const [verification, setVerification] = useState(saved.searchConsoleVerification ?? "");
  // 確かめるのは、欄を離れたときと保存するとき。打っている途中には出さない
  const [gaProblem, setGaProblem] = useState<string | null>(null);
  const [verificationProblem, setVerificationProblem] = useState<string | null>(null);
  /** タグごと貼られたものから、content の値を取り出した */
  const [extracted, setExtracted] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: WikiSettings) => api.updateSettings(input),
    onSuccess: (after) => {
      setDone(savedMessage(saved, after));
      qc.setQueryData(["wiki-settings"], after);
      // プロパティ ID が変わると、「アクセス解析」に出すものが変わる
      void qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  /** 欄の中身を保存する形にそろえ、確かめた結果を欄の下に出す。 */
  const checkGa = () => {
    const next = normalizeGaMeasurementId(gaId);
    const problem = gaMeasurementIdProblem(next);
    setGaId(next);
    setGaProblem(problem);
    return { value: next === "" ? null : next, problem };
  };
  const checkProperty = () => {
    const next = propertyId.trim();
    const problem = gaPropertyIdProblem(next);
    setPropertyId(next);
    setPropertyProblem(problem);
    return { value: next === "" ? null : next, problem };
  };
  const checkVerification = () => {
    const next = extractSearchConsoleVerification(verification);
    const problem = searchConsoleVerificationProblem(next);
    if (next !== verification.trim()) setExtracted(problem === null);
    setVerification(next);
    setVerificationProblem(problem);
    return { value: next === "" ? null : next, problem };
  };

  const propertyChanged = (propertyId.trim() || null) !== saved.gaPropertyId;
  const changed =
    (normalizeGaMeasurementId(gaId) || null) !== saved.gaMeasurementId ||
    (extractSearchConsoleVerification(verification) || null) !== saved.searchConsoleVerification ||
    propertyChanged;
  const edited = () => {
    setDone(null);
    save.reset();
  };

  return (
    <Stack
      component="form"
      spacing={1.5}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const ga = checkGa();
        const sc = checkVerification();
        const property = checkProperty();
        if (ga.problem || sc.problem || property.problem || !changed || save.isPending) return;
        save.mutate({ gaMeasurementId: ga.value, searchConsoleVerification: sc.value, gaPropertyId: property.value });
      }}
    >
      <Section>
        <IntegrationTitle
          name="Google Analytics"
          connected={saved.gaMeasurementId !== null}
          help="測定 ID を保存すると、公開サイトのページに Google タグが入り、閲覧を Google Analytics（GA4）で分析できます。"
        />
        <Box component="ol" sx={{ ...stepsSx, mt: 1 }}>
          <li>
            <ExternalSite href="https://analytics.google.com/">Google Analytics</ExternalSite> で、プロパティを作ります。
          </li>
          <li>データを集める場所（プラットフォーム）は「ウェブ」を選びます。</li>
          <li>
            ストリームの URL に、この wiki の公開サイトの URL を入れます。
            <CopyField label="公開サイトの URL" value={origin} />
          </li>
          <li>表示された測定 ID（「G-」で始まる）を、下の欄に貼って保存します。</li>
        </Box>
        <TextField
          label="測定 ID"
          value={gaId}
          onChange={(e) => {
            setGaId(e.target.value);
            setGaProblem(null);
            edited();
          }}
          onBlur={checkGa}
          placeholder="例：G-XXXXXXXXXX"
          error={gaProblem !== null}
          helperText={gaProblem}
          slotProps={{
            htmlInput: { maxLength: 60, autoCapitalize: "characters", autoCorrect: "off", spellCheck: false },
            inputLabel: { shrink: true },
            input: {
              sx: { fontFamily: "monospace" },
              endAdornment: (
                <InputAdornment position="end">
                  <HelpTip about="測定 ID">「G-」で始まる、GA4 の測定 ID です。空にして保存すると、連携が外れます。</HelpTip>
                </InputAdornment>
              ),
            },
            formHelperText: { role: gaProblem ? "alert" : undefined },
          }}
          sx={{ mt: 2, width: "100%", maxWidth: 420 }}
        />

        <ReadNumbers target="ga" connection={connection} blocked={propertyChanged ? "プロパティ ID を保存してから、確かめられます。" : saved.gaPropertyId ? null : "プロパティ ID を入れて保存すると、確かめられます。"}>
          <li>
            GA の「管理 → プロパティの詳細」の右上に出ている<strong>プロパティ ID</strong>（数字だけ。測定 ID とは別の番号）を、下の欄に入れて保存します。
            <TextField
              label="プロパティ ID"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setPropertyProblem(null);
                edited();
              }}
              onBlur={checkProperty}
              placeholder="例：123456789"
              error={propertyProblem !== null}
              helperText={propertyProblem}
              slotProps={{
                htmlInput: { maxLength: 40, inputMode: "numeric", autoCorrect: "off", spellCheck: false },
                inputLabel: { shrink: true },
                input: {
              sx: { fontFamily: "monospace" },
              endAdornment: (
                <InputAdornment position="end">
                  <HelpTip about="プロパティ ID">数字だけの番号です。公開サイトには出しません。空にして保存すると、GA の数字を読まなくなります。</HelpTip>
                </InputAdornment>
              ),
            },
                formHelperText: { role: propertyProblem ? "alert" : undefined },
              }}
              sx={{ display: "flex", mt: 1.5, mb: 0.5, width: "100%", maxWidth: 420 }}
            />
          </li>
          <li>GA の「管理 → プロパティのアクセス管理」で、下のメールアドレスを「閲覧者」として足します。</li>
        </ReadNumbers>
      </Section>

      <Section>
        <IntegrationTitle
          name="Google サーチコンソール"
          connected={saved.searchConsoleVerification !== null}
          help="確認用の値を保存すると、公開サイトに確認用のタグが入り、サーチコンソールでこの wiki の持ち主であることを確かめられます。"
        />
        <Box component="ol" sx={{ ...stepsSx, mt: 1 }}>
          <li>
            <ExternalSite href="https://search.google.com/search-console">Google サーチコンソール</ExternalSite>{" "}
            でプロパティを追加し、「URL プレフィックス」に、この wiki の公開サイトの URL を入れます。
            <CopyField label="公開サイトの URL" value={origin} />
          </li>
          <li>確認方法は「HTML タグ」を選びます。</li>
          <li>表示されたタグか、その content の値を、下の欄に貼って保存します。</li>
          <li>公開サイトに反映されたあと（保存から数分）、サーチコンソールで「確認」を押します。</li>
          <li>
            確認できたら、サーチコンソールの「サイトマップ」に、サイトマップの URL を送ります。
            <CopyField label="サイトマップの URL" value={`${origin}/sitemap.xml`} />
          </li>
        </Box>
        <TextField
          label="確認用の値"
          value={verification}
          onChange={(e) => {
            setVerification(e.target.value);
            setVerificationProblem(null);
            setExtracted(false);
            edited();
          }}
          onBlur={checkVerification}
          placeholder={'例：<meta name="google-site-verification" content="..." />'}
          error={verificationProblem !== null}
          helperText={verificationProblem ?? (extracted ? "貼られたタグから、content の値を取り出しました。" : null)}
          slotProps={{
            htmlInput: { maxLength: 400, autoCapitalize: "off", autoCorrect: "off", spellCheck: false },
            inputLabel: { shrink: true },
            input: {
              sx: { fontFamily: "monospace" },
              endAdornment: (
                <InputAdornment position="end">
                  <HelpTip about="確認用の値">タグごと貼ると、content の値だけを取り出します。空にして保存すると、連携が外れます。</HelpTip>
                </InputAdornment>
              ),
            },
            formHelperText: { role: verificationProblem ? "alert" : extracted ? "status" : undefined },
          }}
          sx={{ mt: 2, width: "100%", maxWidth: 680 }}
        />

        <ReadNumbers target="search_console" connection={connection} blocked={null}>
          <li>
            上の手順で、公開サイトの URL を「URL プレフィックス」のプロパティとして登録し、「確認」まで済ませます（入力する欄はありません。プロパティは公開サイトの URL から決まります）。
          </li>
          <li>サーチコンソールの「設定 → ユーザーと権限」で、下のメールアドレスをユーザーとして足します（権限は「制限付き」で足ります）。</li>
        </ReadNumbers>
      </Section>

      {/* 結果は、押したボタンのすぐ上に出す（一般・外観・トップページと同じ場所） */}
      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        {save.error && (
          <Alert severity="error" sx={textSx}>
            {saveErrorMessage(save.error)}
          </Alert>
        )}
        {done && (
          <SaveNotice onClose={() => setDone(null)} sx={textSx}>
            {done}
          </SaveNotice>
        )}
        <Button type="submit" variant="contained" size="medium" disabled={!changed || save.isPending}>
          設定を保存する
        </Button>
        {!changed && !done && <Muted>値を変えると、保存できます。</Muted>}
      </Stack>
    </Stack>
  );
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_input") {
    return "保存できませんでした。測定 ID は「G-」で始まるもの、プロパティ ID は数字だけのもの、確認用の値は半角の英字・数字・「-」「_」だけのものを入れてください。";
  }
  if (err instanceof ApiError && err.code === "owner_only") return "保存できませんでした。変更はオーナーだけが行えます。";
  return errorMessage(err);
}

/** オーナーでない人に出す、いまの値（読むだけ）。 */
function ReadOnlySettings({ settings, connection }: { settings: WikiSettings; connection: GoogleConnection | undefined }) {
  return (
    <>
      <Section>
        <IntegrationTitle name="Google Analytics" connected={settings.gaMeasurementId !== null} />
        <ReadOnlyValue label="測定 ID" value={settings.gaMeasurementId} />
        <ReadOnlyValue label="プロパティ ID（「アクセス解析」が数字を読むのに使う）" value={settings.gaPropertyId} unset="未設定（GA の数字を読みません）" />
        <ConnectionCheckButton target="ga" connection={connection} blocked={settings.gaPropertyId ? null : "プロパティ ID が保存されると、確かめられます。"} />
      </Section>
      <Section>
        <IntegrationTitle name="Google サーチコンソール" connected={settings.searchConsoleVerification !== null} />
        <ReadOnlyValue label="確認用の値" value={settings.searchConsoleVerification} />
        <ConnectionCheckButton target="search_console" connection={connection} blocked={null} />
      </Section>
    </>
  );
}

function ReadOnlyValue({ label, value, unset = "未設定（公開サイトにタグを入れていません）" }: { label: string; value: string | null; unset?: string }) {
  return (
    <Box sx={{ mt: 0.5 }}>
      <Muted>{label}</Muted>
      {value ? <Mono sx={{ display: "block", wordBreak: "break-all" }}>{value}</Mono> : <Typography>{unset}</Typography>}
    </Box>
  );
}

/** まとまりの見出し。保存済みの値で連携しているかを、名前の横に出す。 */
function IntegrationTitle({ name, connected, help }: { name: string; connected: boolean; help?: string }) {
  return (
    <Row sx={{ mb: 0.5 }}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {name}
      </Typography>
      {help && <HelpTip about={`「${name}」`} sx={{ ml: -0.75 }}>{help}</HelpTip>}
      <Muted component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: connected ? "success.main" : "text.secondary" }}>
        {/* 連携しているかは、色だけでなく印と文字でも示す */}
        {connected && <Check size={16} />}
        {connected ? "連携中" : "未設定"}
      </Muted>
    </Row>
  );
}

/** Google の画面へのリンク（別のタブで開く）。 */
export function ExternalSite({ href, children }: { href: string; children: ReactNode }) {
  return (
    <MuiLink href={href} target="_blank" rel="noopener" underline="always" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {children}
      <ExternalLink aria-label="別のタブで開く" size={14} />
    </MuiLink>
  );
}

/** コピーできる値。コピーした結果は、押したボタンに出す。 */
function CopyField({ label, value, what = "URL" }: { label: string; value: string; what?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <Row sx={{ mt: 0.5 }}>
      <Mono sx={{ px: 1, py: 0.5, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.default", fontSize: "0.875rem", wordBreak: "break-all" }}>
        {value}
      </Mono>
      <Button variant="outlined" startIcon={state === "copied" ? <Check size={16} /> : <Copy size={16} />} aria-label={state === "copied" ? `${label}をコピーしました` : `${label}をコピーする`} onClick={() => void copy()}>
        {state === "copied" ? "コピーしました" : "コピーする"}
      </Button>
      <Box component="span" role="status" sx={{ fontSize: "0.875rem", color: "error.main" }}>
        {state === "failed" ? `コピーできませんでした。${what}を選んでコピーしてください。` : ""}
      </Box>
    </Row>
  );
}

/**
 * まとまりの下のほうに置く「数字を管理画面で見る」：手順（children）、Google へ足すサービスアカウントのメールアドレス、「接続を確かめる」。
 * サービスアカウントの鍵が登録されていない環境では、手順の代わりに、そのことを出す。
 */
function ReadNumbers({ target, connection, blocked, children }: { target: AnalyticsTarget; connection: GoogleConnection | undefined; blocked: string | null; children: ReactNode }) {
  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
      <HelpHeading
        component="h4"
        textSx={{ fontWeight: 600, fontSize: "0.9375rem" }}
        about="「数字を管理画面で見る」"
        help="管理画面は、Google の数字を、人のログインとは別の「サービスアカウント」で読みます。だれが開いても同じ数字が出ます。読むだけで、Google の側の設定は変えません。"
      >
        数字を管理画面で見る（アクセス解析）
      </HelpHeading>
      <Box component="ol" sx={{ ...stepsSx, mt: 1 }}>
        {children}
      </Box>
      {connection?.serviceAccountEmail ? (
        <CopyField label="サービスアカウントのメールアドレス" value={connection.serviceAccountEmail} what="メールアドレス" />
      ) : (
        connection && <ServiceAccountMissing state={connection.serviceAccount} />
      )}
      <ConnectionCheckButton target={target} connection={connection} blocked={blocked} />
    </Box>
  );
}

function ServiceAccountMissing({ state }: { state: GoogleConnection["serviceAccount"] }) {
  return (
    <Alert severity="info" sx={textSx}>
      {state === "invalid"
        ? `サービスアカウントの鍵（${SERVICE_ACCOUNT_SECRET}）が登録されていますが、鍵として読めません。`
        : `この管理画面には、サービスアカウントの鍵（${SERVICE_ACCOUNT_SECRET}）がまだ登録されていないため、足すメールアドレスを出せません。`}
      登録の手順は、
      <RouterLink {...screenLink("/w/$wikiKey/analytics")} underline="always">
        「アクセス解析」
      </RouterLink>
      にあります。測定 ID と確認用の値（公開サイトのタグ）は、鍵が無くても使えます。
    </Alert>
  );
}

/**
 * 「接続を確かめる」。保存してある設定で Google へ問い合わせ、つながったか、だめなら理由と直し方を、押したボタンのそばに出す。
 * `blocked`：まだ確かめられない理由（プロパティ ID を保存していない、など）。
 */
function ConnectionCheckButton({ target, connection, blocked }: { target: AnalyticsTarget; connection: GoogleConnection | undefined; blocked: string | null }) {
  const check = useMutation({ mutationFn: () => api.checkAnalytics(target) });
  // 鍵が無い環境では、押しても確かめられないので出さない（理由は、すぐ上に出ている）
  if (connection?.serviceAccount !== "ready") return null;
  const result = check.data;
  return (
    <Stack spacing={1} sx={{ mt: 1.5, alignItems: "flex-start" }}>
      <Button variant="outlined" disabled={blocked !== null || check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? "確かめています…" : "接続を確かめる"}
      </Button>
      {blocked && <Muted>{blocked}</Muted>}
      {!blocked && result && !check.isPending && (
        <Alert severity={result.ok ? "success" : "error"} icon={result.ok ? <CircleCheck size={20} /> : <TriangleAlert size={20} />} sx={textSx}>
          {checkResultText(result, target)}
        </Alert>
      )}
      {check.error && (
        <Alert severity="error" sx={textSx}>
          {errorMessage(check.error)}
        </Alert>
      )}
    </Stack>
  );
}
