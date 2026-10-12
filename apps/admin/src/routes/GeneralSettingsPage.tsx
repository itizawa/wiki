import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { HelpHeading } from "../components/HelpTip";
import { Mono, Muted, Row, Section } from "../components/ui";
import { WikiIcon } from "../components/WikiIcon";
import { useWikiIdentityForm } from "../components/WikiIdentityForm";
import { useWiki } from "../lib/wiki";

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
      {done && !form.changed && (
        <Alert severity="success" role="status" sx={{ mt: 1.5 }} onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
    </Box>
  );
}
