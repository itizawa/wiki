import { Check, ImageUp, X } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import {
  SITE_NAME_MAX,
  THEME_IMAGE_LIMIT_LABEL,
  THEME_IMAGE_MAX_BYTES,
  THEME_IMAGE_TYPES,
  THEME_PRESETS,
  themePresetFor,
  type ThemeMode,
  type ThemePreset,
  type WikiAppearance,
  type WikiTheme,
} from "@wiki/shared";
import { useEffect, useId, useRef, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useRefreshWikis, useWiki } from "../lib/wiki";

const MODE_LABEL: Record<ThemeMode, string> = { light: "ライト", dark: "ダーク" };

/**
 * 外観：公開サイトのサイト名・テーマ・ロゴ・ファビコン（wiki の管理者だけ）。
 * 入力はプレビューにだけ映し、保存するまで公開サイトには出さない。
 */
export function AppearancePage() {
  const { wiki, role } = useWiki();
  const appearance = useQuery({ queryKey: ["appearance"], queryFn: api.getAppearance, enabled: role === "admin" });

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help={
            <>
              「{wiki.name}」の公開サイトの、サイト名・テーマ（色の組み合わせ）・ロゴ・ファビコンを変えます。色は、読みやすさを確かめたテーマの中から選びます。フォントは変えられません。管理画面の配色は変わりません。
            </>
          }
        >
          外観
        </HelpHeading>
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
  const refreshWikis = useRefreshWikis();
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
      await refreshWikis();
    },
  });

  const dirty = name.trim() !== saved.name || JSON.stringify(theme) !== JSON.stringify(saved.theme);
  const nameOk = name.trim().length >= 1 && name.trim().length <= SITE_NAME_MAX;
  const canSave = dirty && nameOk && !save.isPending;

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

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(0, 1fr)" }, gap: 1.5, alignItems: "start" }}>
      <Stack spacing={1.5}>
        <Section>
          <HelpHeading variant="subtitle1" component="h3" help="ヘッダー・タブのタイトル・RSS・フッターに出ます。wiki の表示名と同じものです。" sx={{ mb: 1 }}>
            サイト名
          </HelpHeading>
          <TextField
            size="small"
            fullWidth
            label="サイト名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={!nameOk}
            helperText={nameOk ? `1〜${SITE_NAME_MAX}文字` : `1〜${SITE_NAME_MAX}文字で入力してください`}
            slotProps={{ htmlInput: { maxLength: SITE_NAME_MAX } }}
          />
        </Section>

        <Section>
          <HelpHeading
            variant="subtitle1"
            component="h3"
            help="公開サイトの背景・文字・リンクなどの色の組み合わせです。見る人の端末の設定がライトのときはライト用、ダークのときはダーク用が使われます。どのテーマも、文字とリンクの色が背景から読み取れる（コントラスト比 4.5 : 1 以上）ことを確かめてあります。"
            sx={{ mb: 1 }}
          >
            テーマ
          </HelpHeading>
          <Stack spacing={2}>
            <ThemeField mode="light" value={theme.presetLight} onChange={(presetLight) => setTheme((t) => ({ ...t, presetLight }))} />
            <ThemeField mode="dark" value={theme.presetDark} onChange={(presetDark) => setTheme((t) => ({ ...t, presetDark }))} />
          </Stack>
        </Section>

        <Section>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            ロゴとファビコン
          </Typography>
          <Stack spacing={2.5}>
            <ImageField
              label="ロゴ"
              help="ヘッダーのサイト名の位置に、高さ 32px で出します。ライトとダークの両方の背景で見えるかを、プレビューで確かめてください。"
              condition={`横長で、高さ 64px 以上がおすすめ。${THEME_IMAGE_LIMIT_LABEL}。`}
              value={theme.logo}
              onChange={(logo) => setTheme((t) => ({ ...t, logo }))}
            />
            <ImageField
              label="ファビコン"
              help="ブラウザのタブに出るアイコンです。"
              condition={`正方形で、180px 以上がおすすめ。${THEME_IMAGE_LIMIT_LABEL}。`}
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
        <HelpHeading variant="subtitle1" component="h3" help="保存するまでは、ここだけが変わります。公開サイトは、保存してから数分で変わります。" sx={{ mb: 1 }}>
          プレビュー
        </HelpHeading>
        <Stack spacing={1.5}>
          <Preview mode="light" name={name.trim() || saved.name} theme={theme} />
          <Preview mode="dark" name={name.trim() || saved.name} theme={theme} />
        </Stack>
      </Section>
    </Box>
  );
}

/** テーマの選択：そのモード向けのテーマを、見本のカード（背景・文字・リンクの色）で並べる。選んでいるものは、枠・印・文字で示す。 */
function ThemeField({ mode, value, onChange }: { mode: ThemeMode; value: string; onChange: (key: string) => void }) {
  const name = useId();
  const presets = THEME_PRESETS.filter((p) => p.mode === mode);
  const selectedKey = themePresetFor(mode, value).key;
  return (
    <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
      <Typography variant="subtitle2" component="legend" sx={{ mb: 0.5, p: 0 }}>
        {MODE_LABEL[mode]}用
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1 }}>
        {presets.map((p) => (
          <ThemeCard key={p.key} preset={p} groupName={name} selected={p.key === selectedKey} onSelect={() => onChange(p.key)} />
        ))}
      </Box>
    </Box>
  );
}

function ThemeCard({ preset, groupName, selected, onSelect }: { preset: ThemePreset; groupName: string; selected: boolean; onSelect: () => void }) {
  const c = preset.colors;
  return (
    <Box
      component="label"
      sx={{
        display: "block",
        cursor: "pointer",
        borderRadius: 1,
        border: 2,
        borderColor: selected ? "primary.main" : "divider",
        overflow: "hidden",
        "&:has(input:focus-visible)": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        "&:hover": { borderColor: selected ? "primary.main" : "text.secondary" },
      }}
    >
      <Box component="input" type="radio" name={groupName} value={preset.key} checked={selected} onChange={onSelect} sx={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
      {/* 背景・文字・リンクの色が分かる見本 */}
      <Box sx={{ bgcolor: c.bg, color: c.text, px: 1.25, py: 1, lineHeight: 1.6, fontSize: "0.8rem", borderBottom: `1px solid ${c.border}` }}>
        <Box sx={{ fontWeight: 700 }}>見出し</Box>
        <Box>
          本文と
          <Box component="span" sx={{ color: c.accent, textDecoration: "underline" }}>
            リンク
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.75, fontSize: "0.875rem", fontWeight: selected ? 700 : 400 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {preset.name}
        </Box>
        {selected && (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, color: "primary.main", fontSize: "0.75rem" }}>
            <Check size={14} aria-hidden />
            選択中
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** ロゴ・ファビコンの選択。条件（`condition`）は選ぶ前に出し、合わないファイルは送る前に断る（API でも確かめる）。使われ方の説明（`help`）は「i」に入れる。 */
function ImageField(props: { label: string; help: string; condition: string; value: string | null; onChange: (value: string | null) => void; square?: boolean }) {
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
      <HelpHeading variant="subtitle2" component="h4" help={props.help}>
        {props.label}
      </HelpHeading>
      <Muted sx={{ mb: 1 }}>{props.condition}</Muted>
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

/** 記事の見本（ヘッダー・リンク・強調のコールアウト）。選んだテーマの色で、公開サイトと同じ配色で描く */
function Preview({ mode, name, theme }: { mode: ThemeMode; name: string; theme: WikiTheme }) {
  const preset = themePresetFor(mode, mode === "light" ? theme.presetLight : theme.presetDark);
  const c = preset.colors;
  const accent = c.accent;
  return (
    <Box
      role="img"
      aria-label={`${MODE_LABEL[mode]}のときの公開サイトの見本（${preset.name}）`}
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
      <Box sx={{ px: 1, pt: 0.5, fontSize: "0.7rem", color: c.muted }}>{MODE_LABEL[mode]}・{preset.name}</Box>
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
          は、テーマのリンクの色で出ます。
        </Box>
        <Box sx={{ my: 1.5, px: 2, py: 1, border: `1px solid ${c.border}`, borderLeft: `4px solid ${accent}`, borderRadius: "6px" }}>
          <Box sx={{ fontSize: "0.8rem", fontWeight: 700, color: accent }}>重要</Box>
          <Box>強調のコールアウトも、同じ色で出ます。</Box>
        </Box>
      </Box>
    </Box>
  );
}
