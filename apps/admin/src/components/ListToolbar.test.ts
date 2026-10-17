import { ThemeProvider } from "@mui/material/styles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adminThemeFor } from "../theme";
import {
  ListToolbar,
  addFilter,
  appliedFiltersText,
  filterChipLabel,
  filterValues,
  removeFilter,
  setFilterValues,
  sortChipLabel,
  toggleOption,
  type ActiveFilter,
  type FilterField,
  type ListToolbarProps,
  type SortField,
} from "./ListToolbar";

const fields: FilterField[] = [
  { key: "page", label: "ページ", kind: "search", search: async () => [] },
  {
    key: "status",
    label: "状態",
    kind: "select",
    options: [
      { value: "succeeded", label: "成功" },
      { value: "failed", label: "失敗" },
    ],
  },
];
const sortFields: SortField[] = [{ key: "createdAt", label: "日時", asc: "古い順", desc: "新しい順" }];
const succeeded = { value: "succeeded", label: "成功" };
const failed = { value: "failed", label: "失敗" };

describe("条件の足し引き", () => {
  it("足した条件は、値を選ぶまで効かない", () => {
    const filters = addFilter([], "page");
    expect(filters).toEqual([{ key: "page", values: [] }]);
    expect(filterValues(filters, "page")).toBeUndefined();
  });

  it("同じ列は二度足さない", () => {
    const filters = addFilter([], "page");
    expect(addFilter(filters, "page")).toBe(filters);
  });

  it("値は複数選べ、選んだ値をもう一度押すと外れる", () => {
    let values = toggleOption([], succeeded);
    values = toggleOption(values, failed);
    expect(values).toEqual([succeeded, failed]);
    expect(toggleOption(values, succeeded)).toEqual([failed]);
  });

  it("値を選ぶと効き、全部外すと効かなくなる。条件を外すと消え、ほかの条件は残る", () => {
    let filters: ActiveFilter[] = addFilter(addFilter([], "page"), "status");
    filters = setFilterValues(filters, "status", [succeeded, failed]);
    expect(filterValues(filters, "status")).toEqual(["succeeded", "failed"]);
    expect(filterValues(setFilterValues(filters, "status", []), "status")).toBeUndefined();
    filters = removeFilter(filters, "status");
    expect(filterValues(filters, "status")).toBeUndefined();
    expect(filters).toEqual([{ key: "page", values: [] }]);
  });
});

describe("チップの文字", () => {
  it("値があれば列の名前と値（複数は「・」でつなぐ）、無ければ列の名前だけ", () => {
    expect(filterChipLabel({ label: "ページ" }, [{ value: "p1", label: "記事A" }])).toBe("ページ: 記事A");
    expect(filterChipLabel({ label: "状態" }, [succeeded, failed])).toBe("状態: 成功・失敗");
    expect(filterChipLabel({ label: "ページ" }, [])).toBe("ページ");
  });

  it("効いている条件だけを並べる", () => {
    const filters: ActiveFilter[] = [
      { key: "page", values: [{ value: "p1", label: "記事A" }] },
      { key: "status", values: [] },
    ];
    expect(appliedFiltersText(fields, filters)).toBe("ページ: 記事A");
    expect(appliedFiltersText(fields, setFilterValues(filters, "status", [succeeded, failed]))).toBe("ページ: 記事A、状態: 成功・失敗");
  });

  it("並べ替えは、列と向きを言葉で出す", () => {
    expect(sortChipLabel(sortFields[0]!, "desc")).toBe("日時：新しい順");
    expect(sortChipLabel(sortFields[0]!, "asc")).toBe("日時：古い順");
  });
});

const render = (props: Partial<ListToolbarProps>) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: adminThemeFor("light") },
      createElement(ListToolbar, { label: "絞り込みと並べ替え", sortFields, sort: { key: "createdAt", direction: "desc" }, filterFields: fields, ...props }),
    ),
  );

describe("ListToolbar", () => {
  it("条件が無いときは、並べ替えのチップと「フィルター」だけを出す", () => {
    const html = render({ filters: [] });
    expect(html).toContain("日時：新しい順");
    expect(html).toContain("フィルター");
    expect(html).not.toContain("絞り込みをすべて外す");
  });

  it("足した条件はチップになり、「すべて外す」が出る。全部の列を足したら「フィルター」は出さない", () => {
    const html = render({
      filters: [
        { key: "page", values: [{ value: "p1", label: "記事A" }] },
        { key: "status", values: [] },
      ],
    });
    expect(html).toContain("ページ: 記事A");
    expect(html).toContain("絞り込み：状態（値を選んでいません）");
    expect(html).toContain("絞り込みをすべて外す");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});
