import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, ListFilter, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Field, Muted } from "./ui";

/**
 * 一覧の上に置く、絞り込みと並べ替えの帯（Notion のデータベースの見た目）。管理画面の一覧の絞り込み・並べ替えは、これで作る。
 * - 並べ替えは、いまの並びをチップ（例:「↓ 日時：新しい順」）でいつも出す。押すと、並べる列と向きを選べる
 * - 「＋ フィルター」で条件を足す。足した条件はチップになり、押すと値を選ぶ欄が開く。値はチェックボックスで複数選べ、どれかに当たるものに絞る。値を選ぶまでは、条件として効かない
 * - 値を選んだ条件のチップは色を変え、値も書く（絞り込み中だと分かるように）。条件が1つでもあれば「すべて外す」を出す
 *
 * 状態は持たない（呼ぶ側が持つ）。値は文字列の組（`FilterOption`）だけなので、URL に載せることもできる。
 */

/** 条件の値。`value` は API に渡す値、`label` はチップに出す文字 */
export type FilterOption = { value: string; label: string };

/** 絞り込める列。値の選び方で `kind` を分ける */
export type FilterField = {
  key: string;
  /** 列の名前（例: 「ページ」） */
  label: string;
} & (
  | {
      /** 打った文字を含むもの */
      kind: "text";
      placeholder?: string;
    }
  | {
      /** 決まった選択肢から選ぶ */
      kind: "select";
      options: FilterOption[];
    }
  | {
      /** 打った語で探して選ぶ（ページなど、数が多いもの）。語が空のときの候補も `search("")` で返す */
      kind: "search";
      search: (query: string) => Promise<FilterOption[]>;
      placeholder?: string;
    }
);

/** 足した条件。`values` のどれかに当たるものに絞る。空のあいだは、チップだけ出て条件としては効かない */
export type ActiveFilter = { key: string; values: FilterOption[] };

export type SortDirection = "asc" | "desc";

/** 並べ替えられる列。`asc` `desc` は向きの言い方（例: 「古い順」「新しい順」） */
export type SortField = { key: string; label: string; asc: string; desc: string };

export type SortValue = { key: string; direction: SortDirection };

/** 条件を足す。もうあれば、そのまま */
export function addFilter(filters: ActiveFilter[], key: string): ActiveFilter[] {
  return filters.some((f) => f.key === key) ? filters : [...filters, { key, values: [] }];
}

export function setFilterValues(filters: ActiveFilter[], key: string, values: FilterOption[]): ActiveFilter[] {
  return filters.map((f) => (f.key === key ? { key, values } : f));
}

/** 値を選んでいれば外し、選んでいなければ足す（チェックボックスを押したとき） */
export function toggleOption(values: FilterOption[], option: FilterOption): FilterOption[] {
  return values.some((v) => v.value === option.value) ? values.filter((v) => v.value !== option.value) : [...values, option];
}

export function removeFilter(filters: ActiveFilter[], key: string): ActiveFilter[] {
  return filters.filter((f) => f.key !== key);
}

/** その列の、効いている条件の値（API に渡すもの）。値を選んでいなければ undefined */
export function filterValues(filters: ActiveFilter[], key: string): string[] | undefined {
  const values = filters.find((f) => f.key === key)?.values ?? [];
  return values.length > 0 ? values.map((v) => v.value) : undefined;
}

/** チップに出す文字。値があれば「状態: 成功・失敗」、無ければ列の名前だけ */
export function filterChipLabel(field: Pick<FilterField, "label">, values: FilterOption[]): string {
  return values.length > 0 ? `${field.label}: ${values.map((v) => v.label).join("・")}` : field.label;
}

/** 効いている条件を、文に入れる形で並べる（例: 「ページ: 記事A、状態: 成功・失敗」）。0件のときの案内などに使う */
export function appliedFiltersText(fields: FilterField[], filters: ActiveFilter[]): string {
  return filters
    .flatMap((f) => {
      const field = fields.find((x) => x.key === f.key);
      return field && f.values.length > 0 ? [filterChipLabel(field, f.values)] : [];
    })
    .join("、");
}

/** 並べ替えのチップに出す文字（例: 「日時：新しい順」） */
export function sortChipLabel(field: SortField, direction: SortDirection): string {
  return `${field.label}：${field[direction]}`;
}

type Opened = { type: "sort" } | { type: "filter"; key: string } | null;

export type ListToolbarProps = {
  /** 読み上げで伝える、この帯の名前（例: 「実行の履歴の絞り込みと並べ替え」） */
  label: string;
  sortFields?: SortField[];
  sort?: SortValue;
  onSortChange?: (sort: SortValue) => void;
  filterFields?: FilterField[];
  filters?: ActiveFilter[];
  onFiltersChange?: (filters: ActiveFilter[]) => void;
};

export function ListToolbar({ label, sortFields = [], sort, onSortChange, filterFields = [], filters = [], onFiltersChange }: ListToolbarProps) {
  const id = useId();
  const [opened, setOpened] = useState<Opened>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const sortField = sort ? sortFields.find((f) => f.key === sort.key) : undefined;
  const addable = filterFields.filter((f) => !filters.some((a) => a.key === f.key));
  const changeFilters = (next: ActiveFilter[]) => onFiltersChange?.(next);
  const chipRef = (key: string) => (el: HTMLElement | null) => {
    if (el) chips.current.set(key, el);
    else chips.current.delete(key);
  };
  // 開いた欄を閉じたら、開いたチップへ戻る（足したばかりの条件は、メニューから開くので、戻り先をここで決める）
  const close = () => {
    const key = opened?.type === "filter" ? opened.key : opened?.type === "sort" ? "__sort" : null;
    setOpened(null);
    // 欄が消えてから戻す（開いているあいだは、欄がフォーカスを中に留める）
    if (key) setTimeout(() => chips.current.get(key)?.focus());
  };
  const openedField = opened?.type === "filter" ? filterFields.find((f) => f.key === opened.key) : undefined;
  const openedFilter = opened?.type === "filter" ? filters.find((f) => f.key === opened.key) : undefined;

  return (
    <Box role="group" aria-label={label} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1.5 }}>
      {sort && sortField && (
        <Chip
          ref={chipRef("__sort")}
          size="small"
          color="primary"
          variant="outlined"
          icon={sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          label={<ChipText text={sortChipLabel(sortField, sort.direction)} />}
          onClick={() => setOpened({ type: "sort" })}
          aria-label={`並べ替え：${sortChipLabel(sortField, sort.direction)}`}
          aria-haspopup="dialog"
          aria-expanded={opened?.type === "sort"}
        />
      )}
      {sort && sortField && filterFields.length > 0 && <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />}
      {filters.map((f) => {
        const field = filterFields.find((x) => x.key === f.key);
        if (!field) return null;
        const text = filterChipLabel(field, f.values);
        const applied = f.values.length > 0;
        return (
          <Chip
            key={f.key}
            ref={chipRef(f.key)}
            size="small"
            // 効いている条件は色で、値の文字でも分かるようにする
            color={applied ? "primary" : "default"}
            variant="outlined"
            icon={<ListFilter size={14} />}
            label={<ChipText text={text} />}
            onClick={() => setOpened({ type: "filter", key: f.key })}
            aria-label={applied ? `絞り込み：${text}` : `絞り込み：${field.label}（値を選んでいません）`}
            aria-haspopup="dialog"
            aria-expanded={opened?.type === "filter" && opened.key === f.key}
            sx={{ maxWidth: 280 }}
          />
        );
      })}
      {addable.length > 0 && (
        <>
          <Button
            size="small"
            color="inherit"
            startIcon={<Plus size={16} />}
            onClick={(e) => setAddAnchor(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={addAnchor !== null}
            aria-controls={addAnchor ? `${id}-add` : undefined}
            sx={{ color: "text.secondary" }}
          >
            フィルター
          </Button>
          <Menu id={`${id}-add`} anchorEl={addAnchor} open={addAnchor !== null} onClose={() => setAddAnchor(null)}>
            {addable.map((f) => (
              <MenuItem
                key={f.key}
                onClick={() => {
                  setAddAnchor(null);
                  changeFilters(addFilter(filters, f.key));
                  setOpened({ type: "filter", key: f.key });
                }}
              >
                {f.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {filters.length > 0 && (
        <Button size="small" color="inherit" startIcon={<X size={16} />} onClick={() => changeFilters([])} sx={{ color: "text.secondary" }}>
          絞り込みをすべて外す
        </Button>
      )}

      {opened && (
        <Popover
          open
          // 足したばかりの条件のチップは、メニューを選んだあとに描かれるので、開くときに探す
          anchorEl={() => chips.current.get(opened?.type === "filter" ? opened.key : "__sort") ?? document.body}
          onClose={close}
          disableRestoreFocus
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{ paper: { role: "dialog", "aria-labelledby": `${id}-title`, sx: { width: 320, maxWidth: "calc(100vw - 32px)", mt: 0.5, p: 1.5 } } }}
        >
          {opened?.type === "sort" && sort && sortField && (
            <SortEditor titleId={`${id}-title`} fields={sortFields} value={sort} onChange={(s) => onSortChange?.(s)} />
          )}
          {openedField && openedFilter && (
            <>
              <Typography id={`${id}-title`} variant="subtitle2" component="h2" sx={{ mb: 1 }}>
                {openedField.label}で絞り込む
              </Typography>
              <FilterEditor field={openedField} values={openedFilter.values} onChange={(v) => changeFilters(setFilterValues(filters, openedField.key, v))} />
              <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<X size={16} />}
                  onClick={() => {
                    setOpened(null);
                    changeFilters(removeFilter(filters, openedField.key));
                  }}
                >
                  この条件を外す
                </Button>
              </Box>
            </>
          )}
        </Popover>
      )}
    </Box>
  );
}

/** チップの文字。長い値は省略し、右に「開く」印を添える */
function ChipText({ text }: { text: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, maxWidth: "100%" }}>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {text}
      </Box>
      <ChevronDown size={14} aria-hidden style={{ flexShrink: 0 }} />
    </Box>
  );
}

function SortEditor({ titleId, fields, value, onChange }: { titleId: string; fields: SortField[]; value: SortValue; onChange: (s: SortValue) => void }) {
  const field = fields.find((f) => f.key === value.key) ?? fields[0]!;
  return (
    <>
      <Typography id={titleId} variant="subtitle2" component="h2" sx={{ mb: 0.5 }}>
        並べ替え
      </Typography>
      {fields.length > 1 && (
        <RadioGroup aria-label="並べる列" value={value.key} onChange={(_, key) => onChange({ key, direction: value.direction })} sx={{ mb: 1 }}>
          {fields.map((f) => (
            <FormControlLabel key={f.key} value={f.key} control={<Radio size="small" />} label={f.label} />
          ))}
        </RadioGroup>
      )}
      <RadioGroup aria-label="並べる向き" value={value.direction} onChange={(_, d) => onChange({ key: value.key, direction: d as SortDirection })}>
        <FormControlLabel value="desc" control={<Radio size="small" />} label={field.desc} />
        <FormControlLabel value="asc" control={<Radio size="small" />} label={field.asc} />
      </RadioGroup>
    </>
  );
}

type EditorProps<F> = { field: F; values: FilterOption[]; onChange: (values: FilterOption[]) => void };

function FilterEditor({ field, values, onChange }: EditorProps<FilterField>) {
  switch (field.kind) {
    case "select":
      return <OptionChecks label={field.label} options={field.options} values={values} onChange={onChange} />;
    case "text":
      return <TextFilter field={field} values={values} onChange={onChange} />;
    case "search":
      return <SearchFilter field={field} values={values} onChange={onChange} />;
  }
}

/** 選択肢のチェックボックスの並び。押すたびに、その場で条件に効く */
function OptionChecks({ label, options, values, onChange }: { label: string; options: FilterOption[]; values: FilterOption[]; onChange: (values: FilterOption[]) => void }) {
  return (
    <FormGroup aria-label={label}>
      {options.map((o) => (
        <FormControlLabel
          key={o.value}
          control={<Checkbox size="small" checked={values.some((v) => v.value === o.value)} onChange={() => onChange(toggleOption(values, o))} />}
          label={o.label}
          sx={{ overflowWrap: "anywhere" }}
        />
      ))}
    </FormGroup>
  );
}

/** 打つたびに問い合わせないよう、手が止まってから値にする */
const TEXT_DELAY_MS = 300;

/** 含む文字は1つだけ（文字を変えると、条件が入れ替わる） */
function TextFilter({ field, values, onChange }: EditorProps<Extract<FilterField, { kind: "text" }>>) {
  const current = values[0]?.value ?? "";
  const [draft, setDraft] = useState(current);
  useEffect(() => {
    if (draft === current) return;
    const t = setTimeout(() => onChange(draft.trim() ? [{ value: draft.trim(), label: `「${draft.trim()}」を含む` }] : []), TEXT_DELAY_MS);
    return () => clearTimeout(t);
    // 打った文字が変わったときだけ数え直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <Field
      fullWidth
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder={field.placeholder}
      slotProps={{ htmlInput: { "aria-label": `${field.label}に含む文字` } }}
    />
  );
}

/** 探す欄と、チェックボックスの並び。選んだ値は、探す語に関係なく上に残す（外せるように） */
function SearchFilter({ field, values, onChange }: EditorProps<Extract<FilterField, { kind: "search" }>>) {
  const [input, setInput] = useState("");
  const results = useQuery({ queryKey: ["list-toolbar-search", field.key, input.trim()], queryFn: () => field.search(input.trim()), placeholderData: (prev) => prev });
  const found = (results.data ?? []).filter((o) => !values.some((v) => v.value === o.value));
  return (
    <>
      <Field
        fullWidth
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={field.placeholder}
        slotProps={{ htmlInput: { "aria-label": `${field.label}を探す` } }}
        sx={{ mb: 1 }}
      />
      <Box aria-busy={results.isFetching} sx={{ maxHeight: 280, overflowY: "auto" }}>
        <OptionChecks label={field.label} options={[...values, ...found]} values={values} onChange={onChange} />
        {results.data && values.length + found.length === 0 && <Muted variant="body2">見つかりません</Muted>}
        {!results.data && results.isFetching && <Muted variant="body2">探しています…</Muted>}
      </Box>
    </>
  );
}
