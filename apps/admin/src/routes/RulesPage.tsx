import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Rule, RuleAction, RuleTrigger } from "@wiki/shared";
import { useState } from "react";
import { Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { pageLink, useWiki } from "../lib/wiki";
import { formatDateTime } from "../lib/format";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** ルール：定型ルールの設定、見直しキュー、実行ログ。 */
export function RulesPage() {
  const qc = useQueryClient();
  // ルールの設定を変えられるのは管理者だけ。編集者には、いまの設定を見せるだけにする
  const canEdit = useWiki().role === "admin";
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.listRules });
  const runs = useQuery({ queryKey: ["rules", "runs"], queryFn: api.listRuleRuns });
  const pages = useQuery({ queryKey: ["pages", ""], queryFn: () => api.listPages() });
  const reviewDone = useMutation({
    mutationFn: (id: string) => api.reviewDone(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pages"] }),
  });

  if (rules.isPending) return <Muted>読み込み中…</Muted>;
  if (rules.error) return <Alert severity="error">{errorMessage(rules.error)}</Alert>;

  const queue = (pages.data?.pages ?? [])
    .filter((p) => p.reviewRequestedAt)
    .sort((a, b) => a.reviewRequestedAt!.localeCompare(b.reviewRequestedAt!));
  const titles = new Map((pages.data?.pages ?? []).map((p) => [p.id, p.title]));

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2">
          ルール
        </Typography>
        <Muted>
          有効なルールは5分ごとに動きます。ルールは公開しません。予約枠に入るのは、エディタで「承認済み」にした版だけです。
        </Muted>
        {!canEdit && <Muted sx={{ mt: 1 }}>ルールの設定は、この wiki の管理者だけが変えられます。</Muted>}
      </Section>

      {rules.data.rules.map((rule) => (
        <RuleCard key={`${rule.id}:${rule.updatedAt}`} rule={rule} readOnly={!canEdit} />
      ))}

      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          見直しキュー
        </Typography>
        {reviewDone.error && <Alert severity="error">{errorMessage(reviewDone.error)}</Alert>}
        {queue.length === 0 && <Muted>見直し待ちの記事はありません。</Muted>}
        <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {queue.map((p) => (
            <Row component="li" key={p.id}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <RouterLink {...pageLink(p.id)}>
                  {p.title}
                </RouterLink>
                <Muted component="span">　最終更新 {formatDateTime(p.updatedAt)}</Muted>
              </Box>
              <Button variant="text" disabled={reviewDone.isPending} onClick={() => reviewDone.mutate(p.id)}>
                見直し済み
              </Button>
            </Row>
          ))}
        </Stack>
      </Section>

      <Section>
        <Typography variant="h6" component="h2">
          実行ログ
        </Typography>
        <Muted gutterBottom>ルールが何かをした回と、失敗した回だけが残ります（新しい順、50件まで）。</Muted>
        {runs.data?.runs.length === 0 && <Muted>まだ実行されていません。</Muted>}
        <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0, typography: "body2" }}>
          {runs.data?.runs.map((run) => (
            <Stack component="li" key={run.id} spacing={0.25}>
              <Row>
                <Muted component="span">{formatDateTime(run.createdAt)}</Muted>
                {run.status === "failed" && <StatusChip status="failed" label="失敗" />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {run.ruleName}：{run.summary}
                </Box>
              </Row>
              {run.pageIds.length > 0 && (
                <Row sx={{ pl: 2 }}>
                  {run.pageIds.map((id) => (
                    <RouterLink key={id} {...pageLink(id)}>
                      {titles.get(id) ?? id}
                    </RouterLink>
                  ))}
                </Row>
              )}
            </Stack>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

function RuleCard({ rule, readOnly }: { rule: Rule; readOnly: boolean }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [trigger, setTrigger] = useState<RuleTrigger>(rule.trigger);
  const [actions, setActions] = useState<RuleAction[]>(rule.actions);
  const save = useMutation({
    mutationFn: () => api.saveRule(rule.id, { enabled, trigger, actions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const dirty =
    enabled !== rule.enabled || JSON.stringify([trigger, actions]) !== JSON.stringify([rule.trigger, rule.actions]);
  const setAction = (i: number, next: RuleAction) => setActions(actions.map((a, j) => (j === i ? next : a)));

  return (
    <Section>
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Row sx={{ width: "100%" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" component="h3">
              {rule.name}
            </Typography>
            <Muted>{rule.description}</Muted>
          </Box>
          <FormControlLabel
            control={<Switch checked={enabled} disabled={readOnly} onChange={(e) => setEnabled(e.target.checked)} />}
            label={enabled ? "有効" : "無効"}
          />
        </Row>

        {trigger.type === "stock_below" && (
          <Row>
            今後
            <NumberField disabled={readOnly} value={trigger.days} min={1} max={90} onChange={(days) => setTrigger({ ...trigger, days })} />
            日の公開予約が
            <NumberField disabled={readOnly} value={trigger.min} min={1} max={100} onChange={(min) => setTrigger({ ...trigger, min })} />
            件を下回ったら
          </Row>
        )}
        {trigger.type === "stale" && (
          <Row>
            公開中の記事が
            <NumberField disabled={readOnly} value={trigger.days} min={1} max={3650} onChange={(days) => setTrigger({ ...trigger, days })} />
            日のあいだ更新も見直しもされていなければ
          </Row>
        )}

        {actions.map((action, i) => (
          <Box key={i}>
            {action.type === "schedule_approved" && (
              <Row>
                予約枠（JST）
                {WEEKDAYS.map((label, day) => (
                  <FormControlLabel
                    key={day}
                    sx={{ mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        disabled={readOnly}
                        checked={action.weekdays.includes(day)}
                        onChange={(e) =>
                          setAction(i, {
                            ...action,
                            weekdays: e.target.checked
                              ? [...action.weekdays, day].sort()
                              : action.weekdays.filter((d) => d !== day),
                          })
                        }
                      />
                    }
                    label={label}
                  />
                ))}
                <TextField
                  type="time"
                  disabled={readOnly}
                  value={action.time}
                  onChange={(e) => e.target.value && setAction(i, { ...action, time: e.target.value.slice(0, 5) })}
                  slotProps={{ htmlInput: { "aria-label": "予約枠の時刻" } }}
                />
              </Row>
            )}
            {action.type === "request_review" && <Muted>→ 見直しキューに入れる</Muted>}
            {action.type === "notify" && (
              <Row>
                通知する。続けて通知するのは
                <NumberField
                  disabled={readOnly}
                  value={action.cooldownHours}
                  min={1}
                  max={720}
                  onChange={(cooldownHours) => setAction(i, { ...action, cooldownHours })}
                />
                時間に1回まで
              </Row>
            )}
          </Box>
        ))}

        {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        {!readOnly && (
          <Button variant="contained" size="medium" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        )}
      </Stack>
    </Section>
  );
}

function NumberField(props: { value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <TextField
      type="number"
      disabled={props.disabled}
      value={props.value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= props.min && n <= props.max) props.onChange(n);
      }}
      slotProps={{ htmlInput: { min: props.min, max: props.max } }}
      sx={{ width: 88 }}
    />
  );
}
