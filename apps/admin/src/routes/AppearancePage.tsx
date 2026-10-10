import { CircleAlert, CircleCheck, ImageUp, RotateCcw, X } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import {
  ACCENT_SWATCHES,
  checkAccent,
  DEFAULT_THEME,
  formatContrast,
  isHexColor,
  MIN_CONTRAST,
  SITE_BACKGROUND,
  SITE_NAME_MAX,
  suggestDarkAccent,
  THEME_IMAGE_LIMIT_LABEL,
  THEME_IMAGE_MAX_BYTES,
  THEME_IMAGE_TYPES,
  type AccentMode,
  type WikiAppearance,
  type WikiTheme,
} from "@wiki/shared";
import { useEffect, useId, useRef, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useWiki } from "../lib/wiki";

const MODE_LABEL: Record<AccentMode, string> = { light: "ライト", dark: "ダーク" };

/**
 * 外観：公開サイトのサイト名・アクセント色・ロゴ・ファビコン（wiki の管理者だけ）。
 * 入力はプレビューにだけ映し、保存するまで公開サイトには出さない。
 */
export function AppearancePage() {
  const { wiki, role } = useWiki();
  const appearance = useQuery({ queryKey: ["appearance"], queryFn: api.getAppearance, enabled: role === "admin" });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h1">
          外観
        </Typography>
        <Muted>
          「{wiki.name}」の公開サイトの、サイト名・アクセント色・ロゴ・ファビコンを変えます。背景・文字・枠線の色とフォントは、読みやすさを保つため変えられません。管理画面の配色は変わりません。
        </Muted>
      </Section>
      {role !== "admin" ? (
        <Alert severity="info">外観は、この wiki の管理者だけが変えられます。</Alert>
      ) : appearance.error ? (
        <Alert severity="error">{errorMessage(appearance.error)}</Alert>
      ) : !appearance.data ? (
        <Muted>読み込み中…</Muted>
      ) : (
        <AppearanceForm saved={appearance.data} />
      )}
    </Stack>
  );
}

function AppearanceForm({ saved }: { saved: WikiAppearance }) {
  const qc = useQueryClient();
  const [name, setName] = useState(saved.name);
  const [theme, setTheme] = useState<WikiTheme>(saved.theme);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.saveAppearance({ name: name.trim(), theme }),
    onSuccess: async (res) => {
      qc.setQueryData(["appearance"], res);
      setName(res.name);
      setTheme(res.theme);
      setJustSaved(true);
      // サイト名は wiki の表示名なので、切り替えメニューなどにも出し直す
      await qc.invalidateQueries({ queryKey: ["wikis"] });
    },
  });

  const dirty = name.trim() !== saved.name || JSON.stringify(theme) !== JSON.stringify(saved.theme);
  const nameOk = name.trim().length >= 1 && name.trim().length <= SITE_NAME_MAX;
  const lightCheck = checkAccent(theme.accentLight, "light");
  const darkCheck = checkAccent(theme.accentDark, "dark");
  const canSave = dirty && nameOk && lightCheck.ok && darkCheck.ok && !save.isPending;

  // 変えたら「保存しました」を消す
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  useBlocker({
    shouldBlockFn: async () =>
      dirty &&
      !(await confirmDialog({
        title: "保存していない変更があります",
        body: "このまま移動すると、外観の変更は失われます。公開サイトは今のままです。",
        confirmLabel: "変更を破棄して移動する",
        cancelLabel: "設定に戻る",
        danger: true,
      })),
    enableBeforeUnload: dirty,
  });

  const setLight = (accentLight: string) =>
    // ライト用を選ぶと、ダーク用の候補を自動で入れる（ダーク用はあとから別に直せる）
    setTheme((t) => ({ ...t, accentLight, accentDark: isHexColor(accentLight) ? suggestDarkAccent(accentLight) : t.accentDark }));

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(0, 1fr)" }, gap: 1.5, alignItems: "start" }}>
      <Stack spacing={1.5}>
        <Section>
          <Typography variant="subtitle1" component="h2" gutterBottom>
            サイト名
          </Typography>
          <TextField
            size="small"
            fullWidth
            label="サイト名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={!nameOk}
            helperText={nameOk ? `ヘッダー・タブのタイトル・RSS・フッターに出ます（1〜${SITE_NAME_MAX}文字）。wiki の表示名と同じものです` : `1〜${SITE_NAME_MAX}文字で入力してください`}
            slotProps={{ htmlInput: { maxLength: SITE_NAME_MAX } }}
          />
        </Section>

        <Section>
          <Typography variant="subtitle1" component="h2">
            アクセント色
          </Typography>
          <Muted sx={{ mb: 1.5 }}>
            リンクと、強調のコールアウトの色です。背景とのコントラスト比が {MIN_CONTRAST} : 1 以上（読みやすさの基準。WCAG）の色だけ保存できます。ライト用はライトの背景、ダーク用はダークの背景に対して確かめます。
          </Muted>
          <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
            色の見本
          </Typography>
          <Row sx={{ mb: 2 }}>
            {ACCENT_SWATCHES.map((s) => {
              const selected = theme.accentLight === s.light && theme.accentDark === s.dark;
              return (
                <Box
                  key={s.light}
                  component="button"
                  type="button"
                  title={s.label}
                  aria-label={s.label}
                  aria-pressed={selected}
                  onClick={() => setTheme((t) => ({ ...t, accentLight: s.light, accentDark: s.dark }))}
                  sx={{
                    width: 32,
                    height: 32,
                    p: 0,
                    borderRadius: "50%",
                    cursor: "pointer",
                    border: 2,
                    borderColor: selected ? "text.primary" : "divider",
                    // ライト用とダーク用を半分ずつ見せる
                    background: `linear-gradient(135deg, ${s.light} 50%, ${s.dark} 50%)`,
                    outlineOffset: 2,
                  }}
                />
              );
            })}
          </Row>
          <Stack spacing={2}>
            <AccentField mode="light" value={theme.accentLight} onChange={setLight} />
            <AccentField mode="dark" value={theme.accentDark} onChange={(accentDark) => setTheme((t) => ({ ...t, accentDark }))} />
          </Stack>
          <Button
            sx={{ mt: 1.5 }}
            startIcon={<RotateCcw size={16} />}
            disabled={theme.accentLight === DEFAULT_THEME.accentLight && theme.accentDark === DEFAULT_THEME.accentDark}
            onClick={() => setTheme((t) => ({ ...t, accentLight: DEFAULT_THEME.accentLight, accentDark: DEFAULT_THEME.accentDark }))}
          >
            既定の色に戻す
          </Button>
        </Section>

        <Section>
          <Typography variant="subtitle1" component="h2" gutterBottom>
            ロゴとファビコン
          </Typography>
          <Stack spacing={2.5}>
            <ImageField
              label="ロゴ"
              help={`ヘッダーのサイト名の位置に、高さ 32px で出します。横長の画像で、高さ 64px 以上をおすすめします。ライトとダークの両方の背景で見えるかを、プレビューで確かめてください。${THEME_IMAGE_LIMIT_LABEL}。`}
              value={theme.logo}
              onChange={(logo) => setTheme((t) => ({ ...t, logo }))}
            />
            <ImageField
              label="ファビコン"
              help={`ブラウザのタブに出るアイコンです。正方形で 180px 以上をおすすめします。${THEME_IMAGE_LIMIT_LABEL}。`}
              value={theme.favicon}
              onChange={(favicon) => setTheme((t) => ({ ...t, favicon }))}
              square
            />
          </Stack>
        </Section>

        <Section>
          <Row>
            <Button variant="contained" size="medium" disabled={!canSave} onClick={() => save.mutate()}>
              保存する
            </Button>
            {dirty && (
              <Button size="medium" disabled={save.isPending} onClick={() => (setName(saved.name), setTheme(saved.theme))}>
                変更を取り消す
              </Button>
            )}
          </Row>
          <Muted sx={{ mt: 1 }}>公開サイトへの反映には数分かかります。</Muted>
          {dirty && !(lightCheck.ok && darkCheck.ok) && (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              読みやすさの基準を満たさない色があるため、保存できません。
            </Typography>
          )}
          {save.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
          {justSaved && !dirty && (
            <Alert severity="success" sx={{ mt: 1 }} role="status">
              保存しました。数分後に公開サイトに反映されます。
            </Alert>
          )}
        </Section>
      </Stack>

      <Section sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>
        <Typography variant="subtitle1" component="h2">
          プレビュー
        </Typography>
        <Muted sx={{ mb: 1.5 }}>保存するまでは、ここだけが変わります。</Muted>
        <Stack spacing={1.5}>
          <Preview mode="light" name={name.trim() || saved.name} theme={theme} />
          <Preview mode="dark" name={name.trim() || saved.name} theme={theme} />
        </Stack>
      </Section>
    </Box>
  );
}

/** アクセント色の入力：カラーピッカーと `#` から始まる6桁。入力のたびに、コントラスト比と基準を満たすかを出す。 */
function AccentField({ mode, value, onChange }: { mode: AccentMode; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const check = checkAccent(value, mode);
  // 打ちかけの値（# だけ、5桁など）も入力欄には残す
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
        {MODE_LABEL[mode]}用
      </Typography>
      <Row sx={{ flexWrap: "nowrap" }}>
        <Box
          component="input"
          type="color"
          aria-label={`${MODE_LABEL[mode]}用の色を選ぶ`}
          value={check.valid ? value : "#000000"}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          sx={{ width: 40, height: 36, p: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", cursor: "pointer", flexShrink: 0 }}
        />
        <TextField
          size="small"
          label="色（#rrggbb）"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim().toLowerCase());
          }}
          error={!check.ok}
          slotProps={{ htmlInput: { maxLength: 7, spellCheck: false, "aria-describedby": `${id}-check` } }}
          sx={{ width: 160 }}
        />
      </Row>
      <Box
        id={`${id}-check`}
        role="status"
        sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.75, fontSize: "0.875rem", color: check.ok ? "success.main" : "error.main" }}
      >
        {/* 満たしたかどうかは、色だけでなく印と文字でも示す */}
        {check.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
        {!check.valid ? (
          <span># から始まる6桁で入力してください（例：#2257c5）</span>
        ) : check.ok ? (
          <span>
            {formatContrast(check.ratio!)}　読みやすさの基準を満たしています
          </span>
        ) : (
          <span>
            {formatContrast(check.ratio!)}　読みやすさの基準（{MIN_CONTRAST} : 1）に届いていません。{mode === "light" ? "もっと濃い" : "もっと明るい"}色にしてください
          </span>
        )}
      </Box>
    </Box>
  );
}

/** ロゴ・ファビコンの選択。条件は選ぶ前に出し、合わないファイルは送る前に断る（API でも確かめる）。 */
function ImageField(props: { label: string; help: string; value: string | null; onChange: (value: string | null) => void; square?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: api.uploadThemeImage,
    onSuccess: (res) => {
      setProblem(null);
      props.onChange(res.url);
    },
    onError: (err) => setProblem(errorMessage(err)),
  });

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setProblem(null);
    if (!(THEME_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setProblem(`この形式の画像は使えません。使えるのは ${THEME_IMAGE_LIMIT_LABEL}の画像です（SVG は使えません）。`);
      return;
    }
    if (file.size > THEME_IMAGE_MAX_BYTES) {
      setProblem(`画像が大きすぎます（${Math.ceil(file.size / 1024)}KB）。使えるのは ${THEME_IMAGE_LIMIT_LABEL}の画像です。`);
      return;
    }
    upload.mutate(file);
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        {props.label}
      </Typography>
      <Muted sx={{ mb: 1 }}>{props.help}</Muted>
      <Row>
        {props.value && (
          <Box
            component="img"
            src={props.value}
            alt={`いまの${props.label}`}
            sx={{ height: props.square ? 48 : 32, width: props.square ? 48 : "auto", maxWidth: 240, objectFit: "contain", border: 1, borderColor: "divider", borderRadius: 1, p: 0.5, bgcolor: "background.paper" }}
          />
        )}
        <Button variant="outlined" startIcon={<ImageUp size={16} />} disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? "アップロード中…" : props.value ? "画像を変える" : "画像を選ぶ"}
        </Button>
        {props.value && (
          <Button
            color="error"
            startIcon={<X size={16} />}
            onClick={() => {
              setProblem(null);
              props.onChange(null);
            }}
          >
            画像を外す
          </Button>
        )}
        <input ref={input} type="file" accept={THEME_IMAGE_TYPES.join(",")} hidden onChange={(e) => pick(e.target.files?.[0])} aria-label={`${props.label}の画像を選ぶ`} />
      </Row>
      {problem && (
        <Typography variant="body2" color="error" role="alert" sx={{ mt: 0.5 }}>
          {problem}
        </Typography>
      )}
    </Box>
  );
}

/** 公開サイトの配色（`apps/site/src/styles/global.css`）。背景・文字・枠線は変えられないので、プレビューも固定 */
const SITE_COLORS: Record<AccentMode, { bg: string; text: string; muted: string; border: string }> = {
  light: { bg: SITE_BACKGROUND.light, text: "#1f2328", muted: "#687080", border: "#e4e6ea" },
  dark: { bg: SITE_BACKGROUND.dark, text: "#e6e8ec", muted: "#9aa1b0", border: "#2c3038" },
};

/** 記事の見本（ヘッダー・リンク・強調のコールアウト）。公開サイトと同じ配色で描く */
function Preview({ mode, name, theme }: { mode: AccentMode; name: string; theme: WikiTheme }) {
  const c = SITE_COLORS[mode];
  // 打ちかけの色は、プレビューでは既定の色で見せる
  const accent = checkAccent(mode === "light" ? theme.accentLight : theme.accentDark, mode).valid
    ? mode === "light"
      ? theme.accentLight
      : theme.accentDark
    : DEFAULT_THEME[mode === "light" ? "accentLight" : "accentDark"];
  return (
    <Box
      role="img"
      aria-label={`${MODE_LABEL[mode]}のときの公開サイトの見本`}
      sx={{
        bgcolor: c.bg,
        color: c.text,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        fontFamily: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
        lineHeight: 1.8,
        fontSize: "0.9rem",
      }}
    >
      <Box sx={{ px: 1, pt: 0.5, fontSize: "0.7rem", color: c.muted }}>{MODE_LABEL[mode]}</Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 2, py: 1.25, borderBottom: `1px solid ${c.border}` }}>
        {theme.logo ? (
          <Box component="img" src={theme.logo} alt={name} sx={{ display: "block", height: 32, width: "auto", maxWidth: 200 }} />
        ) : (
          <Box component="span" sx={{ fontWeight: 700 }}>
            {name}
          </Box>
        )}
        <Box sx={{ display: "flex", gap: 1.75, ml: "auto", fontSize: "0.85rem" }}>
          <Box component="span" sx={{ color: accent, textDecoration: "underline" }}>
            検索
          </Box>
          <Box component="span" sx={{ color: accent, textDecoration: "underline" }}>
            RSS
          </Box>
        </Box>
      </Box>
      <Box sx={{ px: 2, py: 1.5 }}>
        <Box sx={{ fontWeight: 700, fontSize: "1.2rem", lineHeight: 1.4 }}>記事の見本</Box>
        <Box sx={{ color: c.muted, fontSize: "0.8rem", mb: 1 }}>2026年10月10日</Box>
        <Box component="p" sx={{ m: 0 }}>
          本文の中の
          <Box component="span" sx={{ color: accent, textDecoration: "underline" }}>
            リンク
          </Box>
          は、アクセント色で出ます。
        </Box>
        <Box sx={{ my: 1.5, px: 2, py: 1, border: `1px solid ${c.border}`, borderLeft: `4px solid ${accent}`, borderRadius: "6px" }}>
          <Box sx={{ fontSize: "0.8rem", fontWeight: 700, color: accent }}>重要</Box>
          <Box>強調のコールアウトも、アクセント色で出ます。</Box>
        </Box>
      </Box>
    </Box>
  );
}
