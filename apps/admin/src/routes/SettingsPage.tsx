import { Check, Copy, ExternalLink } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { extractSearchConsoleVerification, isGaMeasurementId, isSearchConsoleVerification, type WikiSettings } from "@wiki/shared";
import { useEffect, useState, type ReactNode } from "react";
import { Mono, Muted, Row, Section, SkeletonSection } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { useWiki } from "../lib/wiki";

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
  const parts = ["保存しました。公開サイトには数分で反映されます。"];
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

/** `/w/{key}/settings`：wiki ごとの設定。いまは、公開サイトの外部サービスとの連携（Google Analytics・サーチコンソール）。 */
export function SettingsPage() {
  const { wiki, isOwner } = useWiki();
  const settings = useQuery({ queryKey: ["wiki-settings"], queryFn: api.getSettings });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          設定
        </Typography>
        <Muted>
          「{wiki.name}」の公開サイト（<Mono>{wiki.origin}</Mono>）の設定です。wiki ごとに持ち、ほかの wiki には影響しません。
        </Muted>
      </Section>

      <Box sx={{ pt: 1 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          連携
        </Typography>
        <Muted sx={textSx}>
          公開サイトを Google のサービスとつなぎます。限定公開のページ（<Mono>/u/...</Mono>）には、どちらのタグも入れません（限定公開の URL を外へ送らないため）。
        </Muted>
      </Box>

      {!isOwner && <Alert severity="info">変更はオーナーだけが行えます。いまの値は、下で見られます。</Alert>}
      {settings.error && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
      {/* 2つのまとまり（Google Analytics・サーチコンソール）の形 */}
      {settings.isPending && [0, 1].map((i) => <SkeletonSection key={i} lines={3} />)}
      {settings.data && (isOwner ? <SettingsForm origin={wiki.origin} saved={settings.data} /> : <ReadOnlySettings settings={settings.data} />)}
    </Stack>
  );
}

function SettingsForm({ origin, saved }: { origin: string; saved: WikiSettings }) {
  const qc = useQueryClient();
  const [gaId, setGaId] = useState(saved.gaMeasurementId ?? "");
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
  const checkVerification = () => {
    const next = extractSearchConsoleVerification(verification);
    const problem = searchConsoleVerificationProblem(next);
    if (next !== verification.trim()) setExtracted(problem === null);
    setVerification(next);
    setVerificationProblem(problem);
    return { value: next === "" ? null : next, problem };
  };

  const changed =
    (normalizeGaMeasurementId(gaId) || null) !== saved.gaMeasurementId || (extractSearchConsoleVerification(verification) || null) !== saved.searchConsoleVerification;
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
        if (ga.problem || sc.problem || !changed || save.isPending) return;
        save.mutate({ gaMeasurementId: ga.value, searchConsoleVerification: sc.value });
      }}
    >
      <Section>
        <IntegrationTitle name="Google Analytics" connected={saved.gaMeasurementId !== null} />
        <Muted sx={textSx}>
          測定 ID を保存すると、公開サイトのページに Google タグが入り、閲覧を Google Analytics（GA4）で分析できます。
        </Muted>
        <Box component="ol" sx={{ ...stepsSx, mt: 1.5 }}>
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
          helperText={gaProblem ?? "「G-」で始まる、GA4 の測定 ID です。空にして保存すると、連携が外れます。"}
          slotProps={{
            htmlInput: { maxLength: 60, autoCapitalize: "characters", autoCorrect: "off", spellCheck: false },
            inputLabel: { shrink: true },
            input: { sx: { fontFamily: "monospace" } },
            formHelperText: { role: gaProblem ? "alert" : undefined },
          }}
          sx={{ mt: 2, width: "100%", maxWidth: 420 }}
        />
      </Section>

      <Section>
        <IntegrationTitle name="Google サーチコンソール" connected={saved.searchConsoleVerification !== null} />
        <Muted sx={textSx}>
          確認用の値を保存すると、公開サイトに確認用のタグが入り、サーチコンソールでこの wiki の持ち主であることを確かめられます。
        </Muted>
        <Box component="ol" sx={{ ...stepsSx, mt: 1.5 }}>
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
          helperText={
            verificationProblem ??
            (extracted
              ? "貼られたタグから、content の値を取り出しました。"
              : "タグごと貼ると、content の値だけを取り出します。空にして保存すると、連携が外れます。")
          }
          slotProps={{
            htmlInput: { maxLength: 400, autoCapitalize: "off", autoCorrect: "off", spellCheck: false },
            inputLabel: { shrink: true },
            input: { sx: { fontFamily: "monospace" } },
            formHelperText: { role: verificationProblem ? "alert" : extracted ? "status" : undefined },
          }}
          sx={{ mt: 2, width: "100%", maxWidth: 680 }}
        />
      </Section>

      {/* 結果は、押したボタンのそばに出す */}
      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        <Button type="submit" variant="contained" size="medium" disabled={!changed || save.isPending}>
          設定を保存する
        </Button>
        {!changed && !done && <Muted>値を変えると、保存できます。</Muted>}
        {done && (
          <Alert severity="success" onClose={() => setDone(null)} sx={textSx}>
            {done}
          </Alert>
        )}
        {save.error && (
          <Alert severity="error" sx={textSx}>
            {saveErrorMessage(save.error)}
          </Alert>
        )}
      </Stack>
    </Stack>
  );
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_input") {
    return "保存できませんでした。測定 ID は「G-」で始まるもの、確認用の値は半角の英字・数字・「-」「_」だけのものを入れてください。";
  }
  if (err instanceof ApiError && err.code === "owner_only") return "保存できませんでした。変更はオーナーだけが行えます。";
  return errorMessage(err);
}

/** オーナーでない人に出す、いまの値（読むだけ）。 */
function ReadOnlySettings({ settings }: { settings: WikiSettings }) {
  return (
    <>
      <Section>
        <IntegrationTitle name="Google Analytics" connected={settings.gaMeasurementId !== null} />
        <ReadOnlyValue label="測定 ID" value={settings.gaMeasurementId} />
      </Section>
      <Section>
        <IntegrationTitle name="Google サーチコンソール" connected={settings.searchConsoleVerification !== null} />
        <ReadOnlyValue label="確認用の値" value={settings.searchConsoleVerification} />
      </Section>
    </>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string | null }) {
  return (
    <Box sx={{ mt: 0.5 }}>
      <Muted>{label}</Muted>
      {value ? <Mono sx={{ display: "block", wordBreak: "break-all" }}>{value}</Mono> : <Typography>未設定（公開サイトにタグを入れていません）</Typography>}
    </Box>
  );
}

/** まとまりの見出し。保存済みの値で連携しているかを、名前の横に出す。 */
function IntegrationTitle({ name, connected }: { name: string; connected: boolean }) {
  return (
    <Row sx={{ mb: 0.5 }}>
      <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }}>
        {name}
      </Typography>
      <Muted component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: connected ? "success.main" : "text.secondary" }}>
        {/* 連携しているかは、色だけでなく印と文字でも示す */}
        {connected && <Check size={16} />}
        {connected ? "連携中" : "未設定"}
      </Muted>
    </Row>
  );
}

/** Google の画面へのリンク（別のタブで開く）。 */
function ExternalSite({ href, children }: { href: string; children: ReactNode }) {
  return (
    <MuiLink href={href} target="_blank" rel="noopener" underline="always" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {children}
      <ExternalLink aria-label="別のタブで開く" size={14} />
    </MuiLink>
  );
}

/** コピーできる値。コピーした結果は、押したボタンに出す。 */
function CopyField({ label, value }: { label: string; value: string }) {
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
        {state === "failed" ? "コピーできませんでした。URL を選んでコピーしてください。" : ""}
      </Box>
    </Row>
  );
}
