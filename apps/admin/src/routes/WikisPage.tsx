import { ArrowLeft, Circle, CircleCheck, ExternalLink } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { checkWikiKey, isHttpUrl, WIKI_ICON_URL_MAX, WIKI_KEY_MAX, wikiOrigin, type WikiSummary } from "@wiki/shared";
import { useState } from "react";
import { Mono, Muted, RouterLink, Row, Section } from "../components/ui";
import { WikiIcon } from "../components/WikiIcon";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession, useWikis } from "./Layout";

/** key の決まりに、「ほかの wiki が使っていない」を足したもの。入力欄のそばに、どれを満たしたかを出す。 */
export function keyChecks(key: string, taken: readonly string[]): { label: string; ok: boolean }[] {
  return [
    ...checkWikiKey(key).map((c) => ({ label: c.label, ok: key !== "" && c.ok })),
    { label: "ほかの wiki が使っていない（アーカイブ中の wiki を含む）", ok: key !== "" && !taken.includes(key) },
  ];
}

/** wiki の一覧・作成・表示名と画像の変更・アーカイブ・戻す。オーナーにだけ出す。 */
export function WikisPage() {
  const session = useSession();
  const wikis = useWikis();
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<WikiSummary | null>(null);
  const [archiving, setArchiving] = useState<WikiSummary | null>(null);

  const all = wikis.data?.wikis ?? [];
  const active = all.filter((w) => w.archivedAt === null);
  const archived = all.filter((w) => w.archivedAt !== null);

  return (
    <Stack spacing={1.5}>
      <Box>
        <RouterLink to="/" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <ArrowLeft size={18} />
          {active.length > 0 ? "wiki の画面に戻る" : "最初の画面に戻る"}
        </RouterLink>
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          wiki の管理
        </Typography>
        <Muted>wiki ごとに、ページ・ツリー・ルール・予約を分け、それぞれ別のサブドメインで公開します。</Muted>
      </Box>

      {!session.isOwner && <Alert severity="info">wiki の作成・アーカイブは、オーナーだけが行えます。</Alert>}
      {wikis.error && <Alert severity="error">{errorMessage(wikis.error)}</Alert>}
      {session.isOwner && wikis.data && <CreateWiki baseDomain={wikis.data.baseDomain} taken={all.map((w) => w.key)} />}

      {session.isOwner && (
        <Section>
          <Typography variant="h6" component="h2" gutterBottom>
            使用中の wiki
          </Typography>
          {done && (
            <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
              {done}
            </Alert>
          )}
          {wikis.isPending && <Muted>読み込み中…</Muted>}
          {wikis.data && active.length === 0 && (
            <Muted>使用中の wiki はありません。上の「wiki を作成する」から作るか、下のアーカイブ中の wiki を元に戻してください。</Muted>
          )}
          {active.length > 0 && (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>表示名 / key</TableCell>
                    <TableCell>公開 URL</TableCell>
                    <TableCell align="right">公開中のページ</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {active.map((w) => (
                    <TableRow key={w.key}>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                          <WikiIcon wiki={w} size={32} />
                          <div>
                            <RouterLink to="/w/$wikiKey" params={{ wikiKey: w.key }} sx={{ fontWeight: 600 }}>
                              {w.name}
                            </RouterLink>
                            <Muted>
                              <Mono>{w.key}</Mono>
                            </Muted>
                          </div>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <SiteLink origin={w.origin} />
                      </TableCell>
                      <TableCell align="right">{w.publishedPages}件</TableCell>
                      <TableCell>
                        {/* 取り返しのつきにくい操作（アーカイブ）は、ほかの操作から離して置く */}
                        <Row sx={{ flexWrap: "nowrap" }}>
                          <Button variant="outlined" onClick={() => setEditing(w)}>
                            表示名と画像
                          </Button>
                          <Button variant="outlined" color="error" onClick={() => setArchiving(w)} sx={{ ml: 3 }}>
                            アーカイブ
                          </Button>
                        </Row>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>
      )}

      {session.isOwner && archived.length > 0 && <ArchivedWikis wikis={archived} />}

      {editing && (
        <EditDialog
          wiki={editing}
          onClose={() => setEditing(null)}
          onDone={(before, w) => {
            setEditing(null);
            setDone(
              before.name !== w.name
                ? `「${w.name}」を保存しました。表示名は、公開サイトに次のビルドで反映されます。`
                : `「${w.name}」の画像を保存しました。`,
            );
          }}
        />
      )}
      {archiving && (
        <ArchiveDialog
          wiki={archiving}
          onClose={() => setArchiving(null)}
          onDone={(w) => {
            setArchiving(null);
            setDone(`「${w.name}」をアーカイブしました。下の「アーカイブ中の wiki」から元に戻せます。`);
          }}
        />
      )}
    </Stack>
  );
}

/** 公開サイトへのリンク（別のタブで開く）。 */
function SiteLink({ origin }: { origin: string }) {
  return (
    <MuiLink href={origin} target="_blank" rel="noopener" underline="always" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Mono>{origin}</Mono>
      <ExternalLink aria-label="別のタブで開く" size={14} />
    </MuiLink>
  );
}

function CreateWiki({ baseDomain, taken }: { baseDomain: string; taken: string[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const checks = keyChecks(key, taken);
  const valid = checks.every((c) => c.ok) && name.trim() !== "";
  const create = useMutation({
    mutationFn: () => api.createWiki({ key, name: name.trim() }),
    onSuccess: async (wiki) => {
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      await navigate({ to: "/w/$wikiKey", params: { wikiKey: wiki.key } });
    },
  });
  const keyTaken = create.error instanceof ApiError && create.error.code === "wiki_key_taken";

  return (
    <Section>
      <Typography variant="h6" component="h2" gutterBottom>
        wiki を作成する
      </Typography>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !create.isPending) create.mutate();
        }}
        sx={{ maxWidth: 560 }}
      >
        <TextField
          label="表示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：開発ノート"
          helperText="公開サイトの名前になります。あとから変えられます。"
          slotProps={{ htmlInput: { maxLength: 100 }, inputLabel: { shrink: true } }}
          sx={{ maxWidth: 360 }}
        />
        <Box>
          <TextField
            label="key（公開サイトのサブドメイン）"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              create.reset();
            }}
            placeholder="例：notes"
            error={keyTaken}
            slotProps={{
              htmlInput: { maxLength: WIKI_KEY_MAX, autoCapitalize: "off", autoCorrect: "off", spellCheck: false, "aria-describedby": "wiki-key-rules" },
              inputLabel: { shrink: true },
              input: { endAdornment: <InputAdornment position="end">.{baseDomain}</InputAdornment>, sx: { fontFamily: "monospace" } },
            }}
            sx={{ width: "100%", maxWidth: 440 }}
          />
          {keyTaken && (
            <Typography variant="body2" color="error" role="alert" sx={{ mt: 0.5 }}>
              {errorMessage(create.error)}
            </Typography>
          )}
          <Box id="wiki-key-rules" sx={{ mt: 1 }}>
            <Alert severity="warning" sx={{ mb: 1 }}>
              key は作成後に変えられません（公開サイトの URL がすべて変わるため）。
            </Alert>
            <Muted>公開 URL</Muted>
            {/* 決まりを満たすまでは、できあがる URL の形だけを見せる */}
            <Mono sx={{ display: "block", mb: 1, wordBreak: "break-all" }}>{wikiOrigin(checks.every((c) => c.ok) ? key : "{key}", baseDomain)}</Mono>
            <Muted>key の決まり</Muted>
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
              {checks.map((c) => (
                <Box component="li" key={c.label} sx={{ position: "relative", display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.875rem", color: c.ok ? "success.main" : "text.secondary" }}>
                  {/* 満たしたかどうかは、色だけでなく印の形でも示す */}
                  {c.ok ? <CircleCheck size={16} /> : <Circle size={16} />}
                  <span>
                    {c.label}
                    <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                      {c.ok ? "（満たしています）" : "（まだ満たしていません）"}
                    </Box>
                  </span>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
        <Muted>作った wiki には、空のツリーを1本用意します。ルールは、どれも無効で始まります。</Muted>
        {create.error && !keyTaken && <Alert severity="error">{errorMessage(create.error)}</Alert>}
        <Box>
          <Button type="submit" variant="contained" size="medium" disabled={!valid || create.isPending}>
            wiki を作成する
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

/** 画像の URL の入力欄の確かめ。空なら「画像なし」。 */
export function iconUrlProblem(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (v.length > WIKI_ICON_URL_MAX) return `URL が長すぎます（${WIKI_ICON_URL_MAX}文字まで）`;
  if (!isHttpUrl(v)) return "http:// か https:// で始まる URL を入れてください";
  return null;
}

function EditDialog({ wiki, onClose, onDone }: { wiki: WikiSummary; onClose: () => void; onDone: (before: WikiSummary, after: WikiSummary) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(wiki.name);
  const [iconUrl, setIconUrl] = useState(wiki.iconUrl ?? "");
  const nextIcon = iconUrl.trim() === "" ? null : iconUrl.trim();
  const problem = iconUrlProblem(iconUrl);
  const changed = name.trim() !== wiki.name || nextIcon !== wiki.iconUrl;
  const save = useMutation({
    mutationFn: () => api.updateWiki(wiki.key, { name: name.trim(), iconUrl: nextIcon }),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      onDone(wiki, w);
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !problem && changed && !save.isPending) save.mutate();
        }}
      >
        <DialogTitle>表示名と画像</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label="表示名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              fullWidth
              helperText={`公開サイトの名前になります。key（${wiki.key}）と公開 URL は変わりません。`}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <Box>
              <TextField
                label="画像の URL（任意）"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                fullWidth
                placeholder="https://example.com/icon.png"
                error={problem !== null}
                helperText={problem ?? "サイドバーと wiki の切り替えで、表示名の頭文字の代わりに出します。正方形の画像がきれいに収まります。空にすると頭文字に戻ります。"}
                slotProps={{ htmlInput: { maxLength: WIKI_ICON_URL_MAX, inputMode: "url", spellCheck: false }, inputLabel: { shrink: true } }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1.5 }}>
                <Muted>見え方</Muted>
                {/* 入力中の URL で、実際に出る形を見せる（読み込めなければ頭文字になる） */}
                <WikiIcon key={nextIcon ?? ""} wiki={{ name: name.trim() || wiki.name, iconUrl: problem ? null : nextIcon }} size={28} />
                <WikiIcon key={`l${nextIcon ?? ""}`} wiki={{ name: name.trim() || wiki.name, iconUrl: problem ? null : nextIcon }} size={40} />
                {iconUrl !== "" && (
                  <Button variant="text" onClick={() => setIconUrl("")} sx={{ ml: "auto" }}>
                    画像を外す
                  </Button>
                )}
              </Box>
            </Box>
            {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            変更しない
          </Button>
          <Button type="submit" variant="contained" disabled={!name.trim() || problem !== null || !changed || save.isPending}>
            保存する
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** アーカイブの前に、公開中のページの件数と、止まる URL を見せて確かめる。 */
function ArchiveDialog({ wiki, onClose, onDone }: { wiki: WikiSummary; onClose: () => void; onDone: (wiki: WikiSummary) => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => api.archiveWiki(wiki.key),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      onDone(w);
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>「{wiki.name}」をアーカイブしますか？</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Box>
            <Muted>止まる公開サイト</Muted>
            <Mono sx={{ display: "block", wordBreak: "break-all" }}>{wiki.origin}</Mono>
          </Box>
          <Box>
            <Muted>公開中のページ</Muted>
            <Typography>{wiki.publishedPages}件（次のビルドから、どれも見られなくなります）</Typography>
          </Box>
          <Box component="ul" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 } }}>
            <li>公開サイトは次のビルドで止まり、このサブドメインは「ページが見つかりません」（404）になります。</li>
            <li>管理画面の wiki の一覧から外れ、予約とルールは実行されなくなります。</li>
            <li>
              ページなどのデータは残ります。この画面の「アーカイブ中の wiki」から、いつでも元に戻せます。key（<Mono>{wiki.key}</Mono>）は、ほかの wiki では使えないままです。
            </li>
          </Box>
          {archive.error && <Alert severity="error">{errorMessage(archive.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        <Button variant="text" onClick={onClose} autoFocus>
          アーカイブしない
        </Button>
        <Button variant="contained" color="error" disabled={archive.isPending} onClick={() => archive.mutate()}>
          アーカイブする
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ArchivedWikis({ wikis }: { wikis: WikiSummary[] }) {
  const qc = useQueryClient();
  const [restored, setRestored] = useState<WikiSummary | null>(null);
  const restore = useMutation({
    mutationFn: (key: string) => api.unarchiveWiki(key),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["wikis"] });
      setRestored(w);
    },
  });
  return (
    <Section>
      <Typography variant="h6" component="h2">
        アーカイブ中の wiki
      </Typography>
      <Muted sx={{ mb: 1 }}>
        元に戻すと、公開サイトは次のビルドでまた見られるようになります。止まっていた間に時刻を過ぎた予約は実行せず、失敗として編集カレンダーに出します。
      </Muted>
      {restore.error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage(restore.error)}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>表示名 / key</TableCell>
            <TableCell>アーカイブした日時</TableCell>
            <TableCell>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {wikis.map((w) => (
            <TableRow key={w.key}>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                  <WikiIcon wiki={w} size={32} />
                  <div>
                    <Box sx={{ fontWeight: 600 }}>{w.name}</Box>
                    <Muted>
                      <Mono>{w.key}</Mono>
                    </Muted>
                  </div>
                </Box>
              </TableCell>
              <TableCell>{formatDateTime(w.archivedAt!)}</TableCell>
              <TableCell>
                <Button variant="outlined" disabled={restore.isPending} onClick={() => restore.mutate(w.key)}>
                  元に戻す
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {restored && (
        <Alert severity="success" onClose={() => setRestored(null)} sx={{ mt: 1 }}>
          「{restored.name}」を元に戻しました。
          <RouterLink to="/w/$wikiKey" params={{ wikiKey: restored.key }} underline="always" sx={{ ml: 0.5 }}>
            「{restored.name}」を開く
          </RouterLink>
        </Alert>
      )}
    </Section>
  );
}
