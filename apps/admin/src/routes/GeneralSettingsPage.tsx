import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Mono, Muted, Row, SaveNotice, Section, StatusChip } from "../components/ui";
import { WikiIcon } from "../components/WikiIcon";
import { useWikiIdentityForm } from "../components/WikiIdentityForm";
import { api, errorMessage } from "../lib/api";
import { useRefreshWikis, useWiki } from "../lib/wiki";

/**
 * 「設定」の「一般」タブ：wiki の表示名と画像（変えるのはオーナーだけ）と、変えられない key・公開サイトの URL。
 * 表示名と画像を変えるのは、この画面だけ（「全体の管理」の wiki の一覧からは、「設定を開く」でここへ来る）。
 */
export function GeneralSettingsPage() {
  const { wiki, isOwner } = useWiki();
  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="subtitle1" component="h2" gutterBottom>
          表示名と画像
        </Typography>
        {isOwner ? (
          <IdentityForm key={wiki.key} />
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 1.5 }}>
              表示名と画像の変更は、オーナーだけが行えます。
            </Alert>
            <Box>
              <Muted>表示名</Muted>
              <Typography>{wiki.name}</Typography>
            </Box>
            <Box sx={{ mt: 1 }}>
              <Muted>画像</Muted>
              <Row sx={{ mt: 0.5 }}>
                <WikiIcon wiki={wiki} size={40} />
                {!wiki.iconUrl && <Typography>未設定（表示名の頭文字を出しています）</Typography>}
              </Row>
            </Box>
          </>
        )}
      </Section>
      <SitePublicSection />
      <RatingsSection />
      <Section>
        <HelpHeading variant="subtitle1" component="h2" help="key は作成後に変えられません（公開サイトの URL がすべて変わるため）。" sx={{ mb: 0.5 }}>
          key と公開サイト
        </HelpHeading>
        <Box>
          <Muted>key</Muted>
          <Mono sx={{ display: "block" }}>{wiki.key}</Mono>
        </Box>
        <Box sx={{ mt: 1 }}>
          <Muted>公開サイトの URL</Muted>
          <MuiLink href={wiki.origin} target="_blank" rel="noreferrer">
            <Mono component="span">{wiki.origin}</Mono>
          </MuiLink>
          {!wiki.sitePublic && <Muted component="span"> （いまは非公開で、だれも見られません）</Muted>}
        </Box>
      </Section>
    </Stack>
  );
}

function IdentityForm() {
  const { wiki } = useWiki();
  const [done, setDone] = useState<string | null>(null);
  const form = useWikiIdentityForm(wiki, {
    onSaved: (before, after) =>
      setDone(before.name !== after.name ? "保存しました。表示名は、公開サイトに次のビルドで反映されます。" : "画像を保存しました。"),
  });
  return (
    <Box
      component="form"
      sx={{ maxWidth: 680 }}
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        form.submit();
      }}
    >
      {form.fields}
      {done && !form.changed && (
        <SaveNotice onClose={() => setDone(null)} sx={{ mt: 2, mb: 0 }}>
          {done}
        </SaveNotice>
      )}
      <Row sx={{ mt: 2 }}>
        <Button type="submit" variant="contained" size="medium" disabled={!form.canSave}>
          保存する
        </Button>
        {form.changed && (
          <Button size="medium" disabled={form.saving} onClick={form.reset}>
            変更を取り消す
          </Button>
        )}
      </Row>
    </Box>
  );
}

/**
 * 公開サイトの公開・非公開（変えるのはオーナーだけ）。非公開の間は、ページの公開範囲を変えないまま、サイトをだれも見られない。
 * 非公開にするときだけ確認を出す（公開に戻すのは、すぐ戻せるので確認しない）。
 */
function SitePublicSection() {
  const { wiki, isOwner } = useWiki();
  const refreshWikis = useRefreshWikis();
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (sitePublic: boolean) => api.updateSettings({ sitePublic }),
    onSuccess: async (_, sitePublic) => {
      await refreshWikis();
      setDone(
        sitePublic
          ? "公開サイトを公開にしました。サイトへの反映は数分後（ビルド後）です。"
          : "公開サイトを非公開にしました。サイトからの取り下げは数分後（ビルド後）です。",
      );
    },
  });

  const change = async (sitePublic: boolean) => {
    setDone(null);
    if (!sitePublic) {
      const ok = await confirmDialog({
        title: `「${wiki.name}」の公開サイトを非公開にしますか？`,
        body: "公開サイトは、だれも見られなくなります。各ページの公開範囲は変わらず、公開に戻せば元のとおりに出ます。サイトに反映されるまで、数分かかります。",
        confirmLabel: "公開サイトを非公開にする",
        cancelLabel: "公開のままにする",
        danger: true,
      });
      if (!ok) return;
    }
    save.mutate(sitePublic);
  };

  return (
    <Section>
      <HelpHeading
        variant="subtitle1"
        component="h2"
        help="非公開の間は、だれも公開サイトを見られません（トップ、各ページ、限定公開の URL、RSS、サイトマップ、検索）。各ページの公開範囲は変わらないので、公開に戻せば元のとおりに出ます。管理画面での編集・公開・予約と、予約の実行は、今までどおり使えます。アーカイブと違い、管理画面の一覧からは外れません。サイトへの反映は数分後（ビルド後）です。"
        sx={{ mb: 0.5 }}
      >
        公開サイトの公開・非公開
      </HelpHeading>
      <Row sx={{ mb: 1 }}>
        <Muted>いまの状態</Muted>
        {wiki.sitePublic ? <StatusChip status="public" label="公開中" /> : <StatusChip label="非公開" />}
      </Row>
      {save.error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {errorMessage(save.error)}
        </Alert>
      )}
      {done && <SaveNotice onClose={() => setDone(null)}>{done}</SaveNotice>}
      {isOwner ? (
        <Button
          variant={wiki.sitePublic ? "outlined" : "contained"}
          color={wiki.sitePublic ? "error" : "primary"}
          size="medium"
          disabled={save.isPending}
          onClick={() => void change(!wiki.sitePublic)}
        >
          {wiki.sitePublic ? "公開サイトを非公開にする" : "公開サイトを公開する"}
        </Button>
      ) : (
        <Alert severity="info">公開サイトの公開・非公開の切り替えは、オーナーだけが行えます。</Alert>
      )}
    </Section>
  );
}

/**
 * 公開サイトのページの評価（星1〜5）を使うか（変えるのはオーナーだけ）。使うと、公開ページの本文の下に評価の欄が出て、
 * 読者がログインせずに付けられる。止めても、付いた評価は消さない（もう一度使えば、元の数のまま出る）。
 */
function RatingsSection() {
  const { wiki, isOwner } = useWiki();
  const refreshWikis = useRefreshWikis();
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (ratingsEnabled: boolean) => api.updateSettings({ ratingsEnabled }),
    onSuccess: async (_, ratingsEnabled) => {
      await refreshWikis();
      setDone(
        ratingsEnabled
          ? "ページの評価を使うようにしました。公開サイトへの反映は数分後（ビルド後）です。"
          : "ページの評価を止めました。公開サイトへの反映は数分後（ビルド後）です。付いた評価は残しています。",
      );
    },
  });

  return (
    <Section>
      <HelpHeading
        variant="subtitle1"
        component="h2"
        help="使うと、公開ページの本文の下に「このページの評価」の欄が出ます。読者はログインせずに星1〜5を付けられ、付け直せます。ほかの人の評価は、平均と、星ごとの件数の棒グラフで出ます。同じ人かどうかはブラウザごとに見分けるので、厳密な1人1票ではありません。止めても、付いた評価は消えません。"
        sx={{ mb: 0.5 }}
      >
        ページの評価
      </HelpHeading>
      <Row sx={{ mb: 1 }}>
        <Muted>いまの状態</Muted>
        {wiki.ratingsEnabled ? <StatusChip status="public" label="使う" /> : <StatusChip label="使わない" />}
      </Row>
      {save.error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {errorMessage(save.error)}
        </Alert>
      )}
      {done && <SaveNotice onClose={() => setDone(null)}>{done}</SaveNotice>}
      {isOwner ? (
        <Button
          variant={wiki.ratingsEnabled ? "outlined" : "contained"}
          size="medium"
          disabled={save.isPending}
          onClick={() => {
            setDone(null);
            save.mutate(!wiki.ratingsEnabled);
          }}
        >
          {wiki.ratingsEnabled ? "ページの評価を止める" : "ページの評価を使う"}
        </Button>
      ) : (
        <Alert severity="info">ページの評価を使うかどうかの切り替えは、オーナーだけが行えます。</Alert>
      )}
    </Section>
  );
}
