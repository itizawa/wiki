import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { HOME_INTRO_MAX, type WikiHome } from "@wiki/shared";
import { useEffect, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Muted, SkeletonEditor } from "../components/ui";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { useWiki } from "../lib/wiki";
import { FULL_HEIGHT } from "./WikiLayout";

/**
 * トップページ：公開サイトのトップ（`/`）の、新着記事の上に出す自由記述（wiki の管理者だけ）。
 * 本文はページと同じエディタで書く。保存するまで公開サイトには出さない。
 */
export function HomeSettingsPage() {
  const { role } = useWiki();
  const home = useQuery({ queryKey: ["home"], queryFn: api.getHome, enabled: role === "admin" });

  if (role !== "admin") {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Alert severity="info">トップページは、この wiki の管理者だけが変えられます。</Alert>
      </Box>
    );
  }
  if (home.error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {errorMessage(home.error)}
      </Alert>
    );
  }
  if (!home.data) return <SkeletonEditor />;
  return <HomeEditor saved={home.data} />;
}

function HomeEditor({ saved }: { saved: WikiHome }) {
  const { wiki } = useWiki();
  const qc = useQueryClient();
  const [introMd, setIntroMd] = useState(saved.introMd);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.saveHome({ introMd }),
    onSuccess: (res) => {
      qc.setQueryData(["home"], res);
      // 保存で前後の空白が削られるので、保存した値に揃える
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (canSave) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, save]);

  useBlocker({
    shouldBlockFn: async () =>
      dirty &&
      !(await confirmDialog({
        title: "保存していない変更があります",
        body: "このまま移動すると、トップページの変更は失われます。公開サイトは今のままです。",
        confirmLabel: "変更を破棄して移動する",
        cancelLabel: "編集に戻る",
        danger: true,
      })),
    enableBeforeUnload: dirty,
  });

  return (
    <Box sx={{ minHeight: FULL_HEIGHT, display: "flex", flexDirection: "column" }}>
      <Box component="header" sx={{ position: "sticky", top: 0, zIndex: 2, height: 48, display: "flex", alignItems: "center", gap: 1, px: 2, bgcolor: "background.paper" }}>
        <Muted component="div" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Box component="span" sx={{ color: "text.primary" }}>
            トップページ
          </Box>
        </Muted>
        <Muted component="div" sx={{ flexShrink: 0, color: tooLong ? "error.main" : undefined, display: { xs: "none", sm: "block" } }}>
          {introMd.length.toLocaleString()} / {HOME_INTRO_MAX.toLocaleString()}文字
        </Muted>
        {dirty && (
          <Button disabled={save.isPending} onClick={() => setIntroMd(saved.introMd)} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            変更を取り消す
          </Button>
        )}
        <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
        </Button>
      </Box>

      <Box sx={{ width: "100%", maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4, pb: 6 }}>
        {save.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(save.error)}
          </Alert>
        )}
        {tooLong && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {HOME_INTRO_MAX.toLocaleString()}文字までです（いま {introMd.length.toLocaleString()}文字）。
          </Alert>
        )}
        {justSaved && !dirty ? (
          <Alert severity="success" sx={{ mb: 3 }} role="status">
            保存しました。数分後に公開サイトに反映されます。
          </Alert>
        ) : (
          <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
            「{wiki.name}」の公開サイトのトップで、新着記事の上に出す紹介文などです。保存するまで公開サイトには出ません。空にすると、トップには新着記事だけが出ます。
          </Alert>
        )}
        <Typography variant="h4" component="h1" sx={{ mb: 2, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}>
          トップページ
        </Typography>
        <MarkdownEditor value={introMd} onChange={setIntroMd} />
      </Box>
    </Box>
  );
}
