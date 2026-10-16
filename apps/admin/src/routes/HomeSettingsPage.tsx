import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { HOME_INTRO_MAX, type HomeBlock, type WikiHome } from "@wiki/shared";
import { useEffect, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { HomeGridEditor } from "../components/HomeGridEditor";
import { Muted, Row, SaveNotice, Section } from "../components/ui";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { initialHomeBlocks, sameBlocks, toSavedBlocks } from "../lib/homeGrid";
import { useWiki } from "../lib/wiki";

/**
 * トップページ：公開サイトのトップ（`/`）の、新着記事の上に出す自由記述（wiki の管理者だけ）。
 * 本文はページと同じエディタで書く。保存するまで公開サイトには出さない。
 */
export function HomeSettingsPage() {
  const { wiki, role } = useWiki();
  const home = useQuery({ queryKey: ["home"], queryFn: api.getHome, enabled: role === "admin" });

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help={
            <>
              「{wiki.name}」の公開サイトのトップで、紹介文などを書き、「配置」で新着記事などと並べる位置・大きさを決めます。保存するまで公開サイトには出ません。紹介文を空にすると、トップには新着記事だけが出ます。
            </>
          }
        >
          トップページ
        </HelpHeading>
      </Section>
      {role !== "admin" ? (
        <Alert severity="info">トップページは、この wiki の管理者だけが変えられます。</Alert>
      ) : home.error ? (
        <Alert severity="error">{errorMessage(home.error)}</Alert>
      ) : !home.data ? (
        <Muted>読み込み中…</Muted>
      ) : (
        <HomeEditor saved={home.data} />
      )}
    </Stack>
  );
}

function HomeEditor({ saved }: { saved: WikiHome }) {
  const qc = useQueryClient();
  const [introMd, setIntroMd] = useState(saved.introMd);
  // null は「配置していない」（自由記述の下に新着記事を並べる、今までの見た目）
  const [blocks, setBlocks] = useState<HomeBlock[] | null>(saved.blocks);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.saveHome({ introMd, blocks: blocks && toSavedBlocks(blocks) }),
    onSuccess: (res) => {
      qc.setQueryData(["home"], res);
      // 保存で前後の空白が削られるので、保存した値に揃える
      setIntroMd(res.introMd);
      setBlocks(res.blocks);
      setJustSaved(true);
    },
  });

  const dirty = introMd !== saved.introMd || !sameBlocks(saved.blocks, blocks);
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
    <Stack spacing={1.5}>
      {/* 本文はページと同じエディタ。「設定」のタブの中に出すので、編集画面のような上の帯は付けず、保存はほかのタブと同じく下に置く */}
      <Section>
        <Typography variant="subtitle1" component="h3" sx={{ mb: 1.5 }}>
          自由記述
        </Typography>
        <Box sx={{ maxWidth: 780 }}>
          <MarkdownEditor value={introMd} onChange={setIntroMd} />
        </Box>
        <Muted sx={{ mt: 1.5, color: tooLong ? "error.main" : undefined }} role={tooLong ? "alert" : undefined}>
          {tooLong
            ? `${HOME_INTRO_MAX.toLocaleString()}文字までです（いま ${introMd.length.toLocaleString()}文字）`
            : `${introMd.length.toLocaleString()} / ${HOME_INTRO_MAX.toLocaleString()}文字`}
        </Muted>
      </Section>

      <Section>
        <HelpHeading
          variant="subtitle1"
          component="h3"
          help={
            <>
              トップに出すものを、12 列のマス目に好きな位置・大きさで並べます。配置していないときは、自由記述の下に新着記事を縦に並べて出します。狭い画面では、配置の順に 1 列で積みます。
            </>
          }
        >
          配置
        </HelpHeading>
        {blocks === null || blocks.length === 0 ? (
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Muted>いまは配置していません。自由記述の下に新着記事を縦に並べて出しています。</Muted>
            <Box>
              <Button variant="outlined" onClick={() => setBlocks(initialHomeBlocks())}>
                マス目で配置する
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <HomeGridEditor blocks={blocks} onChange={setBlocks} />
            <Box>
              <Button size="medium" onClick={() => setBlocks(null)}>
                配置をやめて、今までの並びに戻す
              </Button>
            </Box>
          </Stack>
        )}
      </Section>

      <Section>
        {save.error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(save.error)}
          </Alert>
        )}
        {justSaved && !dirty && <SaveNotice>保存しました。数分後に公開サイトに反映されます。</SaveNotice>}
        <Row>
          <Button variant="contained" size="medium" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : dirty ? "保存する (⌘S)" : "保存済み"}
          </Button>
          {dirty && (
            <Button size="medium" disabled={save.isPending} onClick={() => {
                setIntroMd(saved.introMd);
                setBlocks(saved.blocks);
              }}>
              変更を取り消す
            </Button>
          )}
        </Row>
      </Section>
    </Stack>
  );
}
