import { CircleAlert, CircleCheck, ExternalLink, Plus } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROUTINE_HOST, ROUTINE_NAME_MAX, isRoutineUrl, type RoutineSummary, type RoutineTestResult } from "@wiki/shared";
import { useState } from "react";
import { ConfirmHost, confirmDialog } from "../components/ConfirmDialog";
import { DataList, type ColumnLayout, type DataListColumn } from "../components/DataList";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Field, Mono, Muted, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession } from "./Layout";
import { actionsRowSx } from "./WikisPage";

const ROW_HEIGHT = 56;

/** Routine の一覧の、列の幅と狭い幅（md 未満）での扱い。狭い幅では、URL と登録日を隠し（「編集」で見られる）、操作を行の下に積む。 */
export const routineColumnLayout = {
  name: { width: "minmax(140px, 1fr)" },
  url: { width: "minmax(220px, 2fr)", narrow: "hide" },
  createdAt: { width: "max-content", narrow: "hide" },
  actions: { width: "max-content", narrow: "stack" },
} satisfies ColumnLayout;

/** 一覧のあとで、登録・変更・削除のたびに読み直す */
const KEY = ["routines"];

/**
 * 「全体の管理」の「Routine」：ワークフローが呼ぶ Claude Routine の登録。オーナーにだけ出す。
 * 名前・URL・トークンを一度だけ登録し、各 wiki のワークフローは名前で選ぶ。トークンは保存後、どこにも出さない（「登録済み」とだけ出す）。
 */
export function RoutinesPage() {
  const session = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: api.listRoutines, enabled: session.isOwner });
  // null：開いていない／"new"：登録／行：その Routine の編集
  const [editing, setEditing] = useState<RoutineSummary | "new" | null>(null);
  const [testing, setTesting] = useState<RoutineSummary | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (r: RoutineSummary) => api.deleteRoutine(r.id),
    onSuccess: async (_, r) => {
      await qc.invalidateQueries({ queryKey: KEY });
      setDone(`「${r.name}」を削除しました。`);
    },
  });

  const available = list.data?.available ?? true;

  const askDelete = async (r: RoutineSummary) => {
    const ok = await confirmDialog({
      title: `「${r.name}」を削除しますか？`,
      body: "登録してあるトークンも消えます。元に戻せません。使うときは、URL とトークンをもう一度登録してください。",
      confirmLabel: "削除する",
      cancelLabel: "削除せずに戻る",
      danger: true,
    });
    if (ok) {
      setDone(null);
      remove.mutate(r);
    }
  };

  const columns: DataListColumn<RoutineSummary>[] = [
    { key: "name", header: "名前", ...routineColumnLayout.name, sx: { fontWeight: 600, overflowWrap: "anywhere" }, render: (r) => r.name },
    {
      key: "url",
      header: "URL",
      ...routineColumnLayout.url,
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Mono sx={{ wordBreak: "break-all", fontSize: 13 }}>{r.url}</Mono>
          <Muted sx={{ fontSize: 12 }}>トークン：登録済み</Muted>
        </Box>
      ),
    },
    { key: "createdAt", header: "登録日", ...routineColumnLayout.createdAt, sx: { whiteSpace: "nowrap" }, render: (r) => formatDateTime(r.createdAt) },
    {
      key: "actions",
      header: "操作",
      ...routineColumnLayout.actions,
      render: (r) => (
        // 取り返しのつかない操作（削除）は、ほかの操作から離して置く
        <Row sx={actionsRowSx}>
          <Button variant="outlined" disabled={!available} onClick={() => setTesting(r)} sx={{ whiteSpace: "nowrap" }}>
            テスト実行
          </Button>
          <Button variant="outlined" disabled={!available} onClick={() => setEditing(r)} sx={{ whiteSpace: "nowrap" }}>
            編集
          </Button>
          <Button variant="outlined" color="error" disabled={!available || remove.isPending} onClick={() => askDelete(r)} sx={{ ml: { md: 3 }, whiteSpace: "nowrap" }}>
            削除
          </Button>
        </Row>
      ),
    },
  ];

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      {/* 「wiki の画面に戻る」とページの見出し（h1）は、「全体の管理」の枠（GlobalAdminLayout）にある */}
      <Row sx={{ justifyContent: "space-between" }}>
        <HelpHeading
          variant="h6"
          component="h2"
          help="ワークフローが呼ぶ Claude Routine を、ここで一度だけ登録します。各 wiki のワークフローは、登録した名前で選ぶだけです。URL とトークンは、Claude Code（claude.ai/code/routines）で Routine に「API」のトリガーを足すと出ます。トークンはそのとき一度しか表示されないので、控えてから登録してください。"
        >
          Routine
        </HelpHeading>
        {session.isOwner && (
          <Button variant="contained" size="medium" startIcon={<Plus size={18} />} disabled={!available} onClick={() => setEditing("new")}>
            Routine を登録する
          </Button>
        )}
      </Row>

      {!session.isOwner && <Alert severity="info">Routine の登録は、オーナーだけが行えます。</Alert>}
      {list.error && <Alert severity="error">{errorMessage(list.error)}</Alert>}
      {remove.error && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
      {session.isOwner && list.data && !list.data.available && (
        <Alert severity="warning">
          Routine のトークンを暗号化する鍵（<Mono component="span">ROUTINE_TOKEN_KEY</Mono>）が登録されていないため、登録も実行もできません。32文字以上の値を GitHub のシークレットに登録して、デプロイし直してください。
        </Alert>
      )}

      {session.isOwner && (
        <Section>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            登録済みの Routine
          </Typography>
          {done && (
            <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
              {done}
            </Alert>
          )}
          {/* 読み込みのエラーは、上で出している */}
          <DataList
            label="登録済みの Routine"
            columns={columns}
            rows={list.data?.routines}
            rowKey={(r) => r.id}
            empty="登録済みの Routine はありません。「Routine を登録する」から、名前・URL・トークンを登録してください。"
            rowHeight={ROW_HEIGHT}
            skeletonRows={3}
          />
        </Section>
      )}

      {editing && (
        <RoutineDialog
          routine={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setDone(message);
          }}
        />
      )}
      {testing && <TestDialog routine={testing} onClose={() => setTesting(null)} />}
    </Stack>
  );
}

/** 登録（routine が null）と編集のダイアログ。編集では、トークンは空のままなら変えない。 */
function RoutineDialog({ routine, onClose, onDone }: { routine: RoutineSummary | null; onClose: () => void; onDone: (message: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(routine?.name ?? "");
  const [url, setUrl] = useState(routine?.url ?? "");
  const [token, setToken] = useState("");
  const urlOk = isRoutineUrl(url.trim());
  const valid = name.trim() !== "" && urlOk && (routine !== null || token.trim() !== "");
  const save = useMutation({
    mutationFn: () =>
      routine
        ? api.updateRoutine(routine.id, {
            name: name.trim(),
            url: url.trim(),
            ...(token.trim() !== "" && { token: token.trim() }),
          })
        : api.createRoutine({ name: name.trim(), url: url.trim(), token: token.trim() }),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: KEY });
      onDone(routine ? `「${saved.name}」を保存しました。` : `「${saved.name}」を登録しました。「テスト実行」で、呼べるか確かめられます。`);
    },
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="routine-dialog-title">
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <DialogTitle id="routine-dialog-title">{routine ? `「${routine.name}」を編集する` : "Routine を登録する"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {save.error && (
              <Alert severity="error" role="alert">
                {errorMessage(save.error)}
              </Alert>
            )}
            <Field
              label="名前"
              autoFocus
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                save.reset();
              }}
              placeholder="例：ページ編集"
              helperText="ワークフローで選ぶときの名前です。ほかの Routine と重ならない名前にします。"
              slotProps={{ htmlInput: { maxLength: ROUTINE_NAME_MAX } }}
              sx={{ maxWidth: 420 }}
            />
            <Field
              label="URL"
              required
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                save.reset();
              }}
              placeholder={`例：https://${ROUTINE_HOST}/v1/claude_code/routines/trig_…/fire`}
              error={url.trim() !== "" && !urlOk}
              helperText={`https://${ROUTINE_HOST}/v1/claude_code/routines/…/fire の形の URL だけ登録できます。`}
              slotProps={{
                htmlInput: { maxLength: 500, autoCapitalize: "off", autoCorrect: "off", spellCheck: false, inputMode: "url" },
                input: { sx: { fontFamily: "monospace", fontSize: 14 } },
              }}
            />
            <Field
              label={routine ? "トークン（変えるときだけ入力）" : "トークン"}
              required={routine === null}
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                save.reset();
              }}
              placeholder={routine ? "登録済み" : "sk-ant-oat01-…"}
              helperText={
                routine ? "空のままなら、登録済みのトークンのままです。保存したあと、トークンはどこにも表示されません。" : "保存したあと、トークンはどこにも表示されません。"
              }
              slotProps={{
                htmlInput: { maxLength: 500, autoCapitalize: "off", autoCorrect: "off", spellCheck: false },
                input: { sx: { fontFamily: "monospace", fontSize: 14 } },
              }}
              sx={{ maxWidth: 420 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{routine ? "保存せずに閉じる" : "登録せずに閉じる"}</Button>
          <Button type="submit" variant="contained" disabled={!valid || save.isPending}>
            {save.isPending ? "保存しています…" : routine ? "保存する" : "登録する"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** 「テスト実行」：実行の前に、回数を使うことと、Routine の側で要ることを出し、結果はこのダイアログの中に出す。 */
function TestDialog({ routine, onClose }: { routine: RoutineSummary; onClose: () => void }) {
  const [result, setResult] = useState<RoutineTestResult | null>(null);
  const test = useMutation({ mutationFn: () => api.testRoutine(routine.id), onSuccess: setResult });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="routine-test-title">
      <DialogTitle id="routine-test-title" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        「{routine.name}」をテスト実行する
        <HelpTip about="テスト実行">
          決まりの文（テストであること・ページ ID とタグが「テスト」であること）を送って、Routine を1回呼びます。Claude の側で新しいセッションが1つ始まります。
        </HelpTip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {/* 実行の前に知っておくことなので、ツールチップに入れず出したままにする */}
          <Alert severity="info">
            Routine の回数を1回使います。テストの文では編集リクエストが作られないよう、Routine の指示に「テストと書いてあるときは編集リクエストを作らない」と書いておいてください。
          </Alert>
          {test.error && (
            <Alert severity="error" role="alert">
              {errorMessage(test.error)}
            </Alert>
          )}
          {result && <TestResult result={result} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
        <Button variant="contained" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? "呼んでいます…" : result ? "もう一度テスト実行する" : "テスト実行する"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 結果。成功ならセッションの URL、失敗なら理由と、もう一度試して通りうるか。 */
function TestResult({ result }: { result: RoutineTestResult }) {
  if (result.ok) {
    return (
      <Alert severity="success" icon={<CircleCheck size={20} />} role="status">
        <Box sx={{ fontWeight: 600 }}>成功：Routine が受け付けました</Box>
        <MuiLink href={result.sessionUrl} target="_blank" rel="noopener" underline="always" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, wordBreak: "break-all" }}>
          セッションを開く
          <ExternalLink aria-label="別のタブで開く" size={14} />
        </MuiLink>
        <Muted sx={{ mt: 0.5, wordBreak: "break-all" }}>
          <Mono component="span" sx={{ fontSize: 12 }}>
            {result.sessionUrl}
          </Mono>
        </Muted>
      </Alert>
    );
  }
  return (
    <Alert severity="error" icon={<CircleAlert size={20} />} role="alert">
      <Box sx={{ fontWeight: 600 }}>失敗：{result.message}</Box>
      <Box>
        {result.retryable
          ? `時間をおいて、もう一度試せます${result.reason === "rate_limited" && result.retryAfterSeconds ? `（${result.retryAfterSeconds}秒後から）` : ""}。`
          : "このままもう一度試しても通りません。URL とトークンを確かめて、「編集」から直してください。"}
      </Box>
      {result.status !== undefined && <Muted sx={{ fontSize: 12 }}>応答のステータス：{result.status}</Muted>}
    </Alert>
  );
}
