import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { HOME_INTRO_MAX, type WikiHome } from "@wiki/shared";
import { useEffect, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useWiki } from "../lib/wiki";

/**
 * トップページ：公開サイトのトップ（`/`）の、新着記事の上に出す自由記述（wiki の管理者だけ）。
 * 保存するまで公開サイトには出さない。
 */
export function HomeSettingsPage() {
  const { wiki, role } = useWiki();
  const home = useQuery({ queryKey: ["home"], queryFn: api.getHome, enabled: role === "admin" });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2">
          トップページ
        </Typography>
        <Muted>「{wiki.name}」の公開サイトのトップに出す、紹介文などの自由記述を書きます。トップには、自由記述の下に新着記事が並びます。</Muted>
      </Section>
      {role !== "admin" ? (
        <Alert severity="info">トップページは、この wiki の管理者だけが変えられます。</Alert>
      ) : home.error ? (
        <Alert severity="error">{errorMessage(home.error)}</Alert>
      ) : !home.data ? (
        <Muted>読み込み中…</Muted>
      ) : (
        <HomeForm saved={home.data} />
      )}
    </Stack>
  );
}

function HomeForm({ saved }: { saved: WikiHome }) {
  const qc = useQueryClient();
  const [introMd, setIntroMd] = useState(saved.introMd);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.saveHome({ introMd }),
    onSuccess: (res) => {
      qc.setQueryData(["home"], res);
      setIntroMd(res.introMd);
      setJustSaved(true);
    },
  });

  const dirty = introMd !== saved.introMd;
  const tooLong = introMd.length > HOME_INTRO_MAX;
  const canSave = dirty && !tooLong && !save.isPending;

  // 変えたら「保存しました」を消す
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  useBlocker({
    shouldBlockFn: async () =>
      dirty &&
      !(await confirmDialog({
        title: "保存していない変更があります",
        body: "このまま移動すると、トップページの変更は失われます。公開サイトは今のままです。",
        confirmLabel: "変更を破棄して移動する",
        cancelLabel: "設定に戻る",
        danger: true,
      })),
    enableBeforeUnload: dirty,
  });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="subtitle1" component="h3">
          自由記述
        </Typography>
        <Muted sx={{ mb: 1.5 }}>Markdown で書けます（記事と同じ記法）。空にすると、トップには新着記事だけが出ます。</Muted>
        <TextField
          fullWidth
          multiline
          minRows={10}
          maxRows={30}
          label="自由記述（Markdown）"
          placeholder={"## ようこそ\n\nこの wiki で書いていることの紹介…"}
          value={introMd}
          onChange={(e) => setIntroMd(e.target.value)}
          error={tooLong}
          helperText={
            tooLong
              ? `${HOME_INTRO_MAX.toLocaleString()}文字までです（いま ${introMd.length.toLocaleString()}文字）`
              : `${introMd.length.toLocaleString()} / ${HOME_INTRO_MAX.toLocaleString()}文字`
          }
          slotProps={{ input: { sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.875rem" } } }}
        />
      </Section>

      <Section>
        <Row>
          <Button variant="contained" size="medium" disabled={!canSave} onClick={() => save.mutate()}>
            保存する
          </Button>
          {dirty && (
            <Button size="medium" disabled={save.isPending} onClick={() => setIntroMd(saved.introMd)}>
              変更を取り消す
            </Button>
          )}
        </Row>
        <Muted sx={{ mt: 1 }}>公開サイトへの反映には数分かかります。</Muted>
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
  );
}
