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
  THEME_BACKGROUND_LIMIT_LABEL,
  THEME_BACKGROUND_MAX_BYTES,
  THEME_BACKGROUND_TYPES,
  THEME_IMAGE_LIMIT_LABEL,
  THEME_IMAGE_MAX_BYTES,
  THEME_IMAGE_TYPES,
  THEME_PRESETS,
  themeBackdrop,
  themeModes,
  themeOrnament,
  themePresetFor,
  themeVariant,
  type ThemeMode,
  type ThemePreset,
  type ThemeVariant,
  type WikiAppearance,
  type WikiTheme,
} from "@wiki/shared";
import { useEffect, useId, useRef, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { ImageUploader } from "../components/ImageUploader";
import type { ImageRule } from "../editor/imageFile";
import { Muted, Row, SaveNotice, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useRefreshWikis, useWiki } from "../lib/wiki";

const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" } as const;

/** 本文の幅がこれ以上なら、フォームとプレビューを2列にする（px） */
const TWO_COLUMN_MIN = 800;

const MODE_LABEL: Record<ThemeMode, string> = { light: "ライト", dark: "ダーク" };

/** 背景画像の条件（API の `/appearance/background-images` と同じ） */
const BACKGROUND_RULE: ImageRule = { types: THEME_BACKGROUND_TYPES, maxBytes: THEME_BACKGROUND_MAX_BYTES, limitLabel: THEME_BACKGROUND_LIMIT_LABEL };

/** テーマの背景画像（`custom` があればそれ）を、見本の枠に敷く sx。画像が無ければ空 */
function backdropSx(preset: ThemeVariant, custom: string | null) {
  const b = themeBackdrop(preset, custom);
  return b ? { backgroundImage: b.image, backgroundSize: b.size, backgroundRepeat: b.repeat, backgroundPosition: "center" } : {};
}

/** 見本の右下に置く飾り（公開サイトでは、画面の右下に固定で出るもの）。押せず、読み上げない */
function OrnamentSample({ preset, scale }: { preset: ThemeVariant; scale: number }) {
  const o = themeOrnament(preset);
  if (!o) return null;
  return (
    <Box
      aria-hidden
      sx={{ position: "absolute", right: 8, bottom: 8, width: o.size * scale, height: o.size * scale, pointerEvents: "none", background: `${o.image} no-repeat center / contain` }}
    />
  );
}

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
    // 2列にする区切りは、画面の幅ではなく本文の幅で決める（サイドバーがあると、同じ画面幅でも本文は狭い）。
    // 1列のときは、プレビューをテーマの欄のすぐ下（保存より上）に置き、色を選びながら見られるようにする。
    <Box sx={{ containerType: "inline-size" }}>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          alignItems: "start",
          gridTemplateColumns: "minmax(0, 1fr)",
          gridTemplateAreas: '"name" "theme" "preview" "background" "logo" "save"',
          [`@container (min-width: ${TWO_COLUMN_MIN}px)`]: {
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gridTemplateRows: "repeat(5, auto) 1fr",
            gridTemplateAreas: '"name preview" "theme preview" "background preview" "logo preview" "save preview" ". preview"',
          },
        }}
      >
        <Section sx={{ gridArea: "name" }}>
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

        <Section sx={{ gridArea: "theme" }}>
          <HelpHeading
            variant="subtitle1"
            component="h3"
            help="公開サイトの背景・文字・リンクなどの色の組み合わせです。テーマによっては、薄い背景画像や飾りが付きます。ライト版とダーク版の両方があるテーマは、見る人の端末の設定に合わせて切り替わります。片方しかないテーマは、いつもその版で出ます。どのテーマも、背景画像を重ねた状態で、文字とリンクの色が背景から読み取れる（コントラスト比 4.5 : 1 以上）ことを確かめてあります。"
            sx={{ mb: 1 }}
          >
            テーマ
          </HelpHeading>
          <ThemeField value={theme.preset} onChange={(preset) => setTheme((t) => ({ ...t, preset }))} />
        </Section>

        <Section sx={{ gridArea: "background" }}>
          <HelpHeading
            variant="subtitle1"
            component="h3"
            help="公開サイトの背景に敷く画像です。入れると、テーマに付いている背景画像の代わりに、そのテーマの背景色を薄く重ねて画面いっぱいに出します（重ね方は変えられません）。自分で入れた画像は、読みやすさを確かめられないので、文字やリンクが読みにくくなることがあります。公開サイトで確かめてください。取り消すと、テーマの画像（無いテーマは単色）に戻ります。"
            sx={{ mb: 1 }}
          >
            背景画像
          </HelpHeading>
          <Stack spacing={2.5}>
            {themeModes(themePresetFor(theme.preset)).map((mode) => (
              <BackgroundField
                key={mode}
                mode={mode}
                theme={theme}
                onChange={(value) => setTheme((t) => ({ ...t, [mode === "light" ? "backgroundLight" : "backgroundDark"]: value }))}
              />
            ))}
          </Stack>
        </Section>

        <Section sx={{ gridArea: "logo" }}>
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

        <Section sx={{ gridArea: "save" }}>
          {/* 結果は、押した保存ボタンの上に出す（一般・連携・トップページと同じ場所） */}
          {save.error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
          {justSaved && !dirty && <SaveNotice>保存しました。数分後に公開サイトに反映されます。</SaveNotice>}
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
        </Section>

        <Section sx={{ gridArea: "preview", position: "sticky", top: 16, [`@container (max-width: ${TWO_COLUMN_MIN - 1}px)`]: { position: "static" } }}>
          <HelpHeading variant="subtitle1" component="h3" help="保存するまでは、ここだけが変わります。公開サイトは、保存してから数分で変わります。" sx={{ mb: 1 }}>
            プレビュー
          </HelpHeading>
          <Stack spacing={1.5}>
            {themeModes(themePresetFor(theme.preset)).map((mode) => (
              <Preview key={mode} mode={mode} name={name.trim() || saved.name} theme={theme} />
            ))}
          </Stack>
        </Section>
      </Box>
    </Box>
  );
}

/** 背景画像か飾りを持つテーマか */
function hasDecoration(preset: ThemePreset): boolean {
  return themeModes(preset).some((m) => preset[m]!.background || preset[m]!.ornament || preset[m]!.motion);
}

/** テーマの見本を分けて並べる単位。テーマが増えても、色だけで選びたい人と、飾りつきから選びたい人が探しやすいように */
const THEME_GROUPS = [
  { label: "色だけ", decorated: false },
  { label: "背景・飾りつき", decorated: true },
] as const;

/** テーマの選択：テーマを、見本のカード（ライト版・ダーク版それぞれの背景・文字・リンクの色）で並べる。選んでいるものは、枠・印・文字で示す。 */
function ThemeField({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const name = useId();
  const selectedKey = themePresetFor(value).key;
  return (
    <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
      <Typography component="legend" sx={visuallyHidden}>
        テーマ
      </Typography>
      <Stack spacing={2}>
        {THEME_GROUPS.map((g) => {
          const presets = THEME_PRESETS.filter((p) => hasDecoration(p) === g.decorated);
          return (
            <Box key={g.label}>
              <Typography variant="subtitle2" component="h4" sx={{ mb: 0.75 }}>
                {g.label}
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1 }}>
                {presets.map((p) => (
                  <ThemeCard key={p.key} preset={p} groupName={name} selected={p.key === selectedKey} onSelect={() => onChange(p.key)} />
                ))}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function ThemeSample({ variant, label }: { variant: ThemeVariant; label: string | null }) {
  const c = variant.colors;
  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 0, minHeight: 64, bgcolor: c.bg, ...backdropSx(variant, null), color: c.text, px: 1.25, py: 1, lineHeight: 1.6, fontSize: "0.8rem", borderBottom: `1px solid ${c.border}` }}>
      <Box sx={{ fontWeight: 700 }}>見出し</Box>
      <Box>
        本文と
        <Box component="span" sx={{ color: c.accent, textDecoration: "underline" }}>
          リンク
        </Box>
      </Box>
      {label && <Box sx={{ fontSize: "0.7rem", color: c.muted }}>{label}</Box>}
      <OrnamentSample preset={variant} scale={0.4} />
    </Box>
  );
}

function ThemeCard({ preset, groupName, selected, onSelect }: { preset: ThemePreset; groupName: string; selected: boolean; onSelect: () => void }) {
  const modes = themeModes(preset);
  return (
    <Box
      component="label"
      sx={{
        // 非表示のラジオ（absolute）の基準にする。外すと、ラジオが画面の外まで広がって横スクロールが出る
        position: "relative",
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
      <Box component="input" type="radio" name={groupName} value={preset.key} checked={selected} onChange={onSelect} sx={{ position: "absolute", opacity: 0, width: "1px", height: "1px", pointerEvents: "none" }} />
      {/* 背景・文字・リンクの色が分かる見本。ライト版・ダーク版を持つテーマは、左右に並べる */}
      <Box sx={{ display: "flex" }}>
        {modes.map((mode) => (
          <ThemeSample key={mode} variant={themeVariant(preset, mode)} label={modes.length > 1 ? MODE_LABEL[mode] : null} />
        ))}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.75, fontSize: "0.875rem", fontWeight: selected ? 700 : 400 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {preset.name}
          {modes.length === 1 && <Box component="span" sx={{ ml: 0.75, color: "text.secondary", fontSize: "0.75rem", fontWeight: 400 }}>（{MODE_LABEL[modes[0]!]}のみ）</Box>}
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

/**
 * 背景画像の選択（ライト用・ダーク用）。自分で入れた画像があればそれを、無ければテーマの画像を使う。
 * 入れた画像は「テーマの画像に戻す」で取り消す。条件（形式・大きさ）は、選ぶ前から枠の中に出る。
 */
function BackgroundField({ mode, theme, onChange }: { mode: ThemeMode; theme: WikiTheme; onChange: (value: string | null) => void }) {
  const value = mode === "light" ? theme.backgroundLight : theme.backgroundDark;
  const preset = themePresetFor(theme.preset);
  const variant = themeVariant(preset, mode);
  return (
    <Box>
      <Typography variant="subtitle2" component="h4">
        {MODE_LABEL[mode]}版
      </Typography>
      <Row sx={{ my: 0.75 }}>
        {value ? (
          <>
            <Box component="img" src={value} alt={`いまの${MODE_LABEL[mode]}用の背景画像`} sx={{ height: 48, width: 80, objectFit: "cover", border: 1, borderColor: "divider", borderRadius: 1 }} />
            <Muted>自分で入れた画像を使っています。</Muted>
            <Button color="error" startIcon={<X size={16} />} onClick={() => onChange(null)}>
              テーマの画像に戻す
            </Button>
          </>
        ) : (
          <Muted>{variant.background ? `「${preset.name}」の背景画像を使っています。` : `「${preset.name}」は、単色の背景です。`}</Muted>
        )}
      </Row>
      <ImageUploader
        label={value ? "別の画像に変える…" : "画像を選んでアップロード…"}
        rule={BACKGROUND_RULE}
        upload={api.uploadBackgroundImage}
        onUploaded={onChange}
      />
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
  const preset = themePresetFor(theme.preset);
  const variant = themeVariant(preset, mode);
  const c = variant.colors;
  const accent = c.accent;
  return (
    <Box
      role="img"
      aria-label={`${MODE_LABEL[mode]}のときの公開サイトの見本（${preset.name}）`}
      sx={{
        position: "relative",
        bgcolor: c.bg,
        ...backdropSx(variant, mode === "light" ? theme.backgroundLight : theme.backgroundDark),
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
        <Box sx={{ minHeight: 40 }} />
      </Box>
      <OrnamentSample preset={variant} scale={0.7} />
    </Box>
  );
}
