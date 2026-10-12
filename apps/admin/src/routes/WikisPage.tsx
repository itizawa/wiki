import { Circle, CircleCheck, ExternalLink } from "lucide-react";
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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { checkWikiKey, SITE_NAME_MAX, WIKI_KEY_MAX, wikiOrigin, type WikiSummary } from "@wiki/shared";
import { useState, type ReactNode } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Mono, Muted, RouterLink, Row, Section } from "../components/ui";
import { WikiIcon } from "../components/WikiIcon";
import { useWikiIdentityForm } from "../components/WikiIdentityForm";
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

/** 「使用中の wiki」の行の高さ（読み込み中の行も、この高さで出す）。 */
const WIKI_ROW_HEIGHT = 54;

/** wiki の一覧・作成・表示名と画像の変更・アーカイブ・戻す。オーナーにだけ出す。 */
export function WikisPage() {
  const session = useSession();
  const wikis = useWikis();
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<WikiSummary | null>(null);
  const [archiving, setArchiving] = useState<WikiSummary | null>(null);

  const activeColumns: DataListColumn<WikiSummary>[] = [
    {
      key: "name",
      header: "表示名 / key",
      width: "minmax(200px, 1fr)",
      render: (w) => (
        <WikiName wiki={w}>
          <RouterLink to="/w/$wikiKey" params={{ wikiKey: w.key }} sx={{ fontWeight: 600 }}>
            {w.name}
          </RouterLink>
        </WikiName>
      ),
    },
    { key: "origin", header: "公開 URL", render: (w) => <SiteLink origin={w.origin} /> },
    { key: "publishedPages", header: "公開中のページ", align: "right", sx: { whiteSpace: "nowrap" }, render: (w) => `${w.publishedPages}件` },
    {
      key: "actions",
      header: "操作",
      render: (w) => (
        // 取り返しのつきにくい操作（アーカイブ）は、ほかの操作から離して置く
        <Row sx={{ flexWrap: "nowrap" }}>
          <Button variant="outlined" onClick={() => setEditing(w)}>
            表示名と画像
          </Button>
          <Button variant="outlined" color="error" onClick={() => setArchiving(w)} sx={{ ml: 3 }}>
            アーカイブ
          </Button>
        </Row>
      ),
    },
  ];

  const all = wikis.data?.wikis ?? [];
  const active = all.filter((w) => w.archivedAt === null);
  const archived = all.filter((w) => w.archivedAt !== null);

  return (
    <Stack spacing={1.5}>
      {/* 「wiki の画面に戻る」とページの見出し（h1）は、「全体の管理」の枠（GlobalAdminLayout）にある */}
      <Box>
        <HelpHeading variant="h6" component="h2" help="wiki ごとに、ページ・ツリー・予約を分け、それぞれ別のサブドメインで公開します。">
          wiki
        </HelpHeading>
      </Box>

      {!session.isOwner && <Alert severity="info">wiki の作成・アーカイブは、オーナーだけが行えます。</Alert>}
      {wikis.error && <Alert severity="error">{errorMessage(wikis.error)}</Alert>}
      {session.isOwner && wikis.data && <CreateWiki baseDomain={wikis.data.baseDomain} taken={all.map((w) => w.key)} />}

      {session.isOwner && (
        <Section>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            使用中の wiki
          </Typography>
          {done && (
            <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
              {done}
            </Alert>
          )}
          {/* 読み込みのエラーは、上でまとめて出している */}
          {(wikis.data || wikis.isPending) && (
            <DataList
              label="使用中の wiki"
              columns={activeColumns}
              rows={wikis.data ? active : undefined}
              rowKey={(w) => w.key}
              rowLink={(w) => ({ to: "/w/$wikiKey", params: { wikiKey: w.key } })}
              empty="使用中の wiki はありません。上の「wiki を作成する」から作るか、下のアーカイブ中の wiki を元に戻してください。"
              rowHeight={WIKI_ROW_HEIGHT}
              skeletonRows={3}
            />
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

/** 一覧の「表示名 / key」の列。アイコンの横に、表示名（children）と key を2段で出す。 */
function WikiName({ wiki, children }: { wiki: WikiSummary; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
      <WikiIcon wiki={wiki} size={32} />
      <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {children}
        <Muted>
          <Mono>{wiki.key}</Mono>
        </Muted>
      </Box>
    </Box>
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
      <HelpHeading variant="subtitle1" component="h3" help="作った wiki には、空のツリーを1本用意します。" sx={{ mb: 1 }}>
        wiki を作成する
      </HelpHeading>
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
          slotProps={{
            htmlInput: { maxLength: SITE_NAME_MAX },
            inputLabel: { shrink: true },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <HelpTip about="表示名">公開サイトの名前になります。あとから変えられます。</HelpTip>
                </InputAdornment>
              ),
            },
          }}
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

function EditDialog({ wiki, onClose, onDone }: { wiki: WikiSummary; onClose: () => void; onDone: (before: WikiSummary, after: WikiSummary) => void }) {
  const form = useWikiIdentityForm(wiki, { autoFocus: true, onSaved: (_, w) => onDone(wiki, w) });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          form.submit();
        }}
      >
        <DialogTitle>表示名と画像</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>{form.fields}</Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            変更しない
          </Button>
          <Button type="submit" variant="contained" disabled={!form.canSave}>
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
            <li>管理画面の wiki の一覧から外れ、予約は実行されなくなります。</li>
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
      <HelpHeading
        variant="subtitle1"
        component="h3"
        help="元に戻すと、公開サイトは次のビルドでまた見られるようになります。止まっていた間に時刻を過ぎた予約は実行せず、失敗として編集カレンダーに出します。"
        sx={{ mb: 0.5 }}
      >
        アーカイブ中の wiki
      </HelpHeading>
      {restore.error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage(restore.error)}
        </Alert>
      )}
      {/* アーカイブ中の wiki は開けないので、行の遷移先は渡さない（押せる見た目にならない） */}
      <DataList
        label="アーカイブ中の wiki"
        columns={[
          {
            key: "name",
            header: "表示名 / key",
            width: "minmax(200px, 1fr)",
            render: (w) => (
              <WikiName wiki={w}>
                <Box sx={{ fontWeight: 600 }}>{w.name}</Box>
              </WikiName>
            ),
          },
          { key: "archivedAt", header: "アーカイブした日時", sx: { whiteSpace: "nowrap" }, render: (w) => formatDateTime(w.archivedAt!) },
          {
            key: "actions",
            header: "操作",
            render: (w) => (
              <Button variant="outlined" disabled={restore.isPending} onClick={() => restore.mutate(w.key)}>
                元に戻す
              </Button>
            ),
          },
        ]}
        rows={wikis}
        rowKey={(w) => w.key}
        empty="アーカイブ中の wiki はありません。"
      />
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
