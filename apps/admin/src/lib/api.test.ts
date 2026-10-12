import { IMAGE_LIMIT_LABEL, PAGE_TITLE_MAX } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, invalidInputMessage } from "./api";

const err = (code: string, message: string, details?: unknown) => errorMessage(new ApiError(400, code, message, details));

describe("errorMessage", () => {
  it("names the title and its limit for invalid_input on the title", () => {
    const details = [{ code: "too_big", path: ["title"], maximum: 200 }];
    expect(err("invalid_input", "invalid input", details)).toBe("タイトルは200字までです。短くしてください。");
  });
  it("asks for a title when it is empty", () => {
    expect(err("invalid_input", "invalid input", [{ code: "too_small", path: ["title"] }])).toBe("タイトルを入れてください。");
  });
  it("names the field for other known fields", () => {
    expect(err("invalid_input", "invalid input", [{ code: "too_big", path: ["bodyMd"] }])).toContain("本文");
  });
  it("never shows the English message for invalid_input", () => {
    expect(err("invalid_input", "invalid input")).not.toContain("invalid");
    expect(err("invalid_input", "invalid input", [{ path: ["unknown"] }])).toContain("各項目を確かめて");
  });
  it("translates not_found and invalid_request", () => {
    expect(err("not_found", "page doesnotexist not found")).not.toContain("doesnotexist");
    expect(err("invalid_request", "the request has expired; start connecting from the app again")).toMatch(/^接続の依頼/);
  });
  it("keeps the existing messages", () => {
    expect(err("version_conflict", "conflict")).toContain("最新の版");
  });
});

/** `details` を使わず、`code` だけで決まる文言（元の switch の case を機械的に拾って固めた） */
const FIXED_MESSAGES: [string, string][] = [
  ["not_found", "見つかりません。ゴミ箱に入れられたか、URL が違います。"],
  ["invalid_request", "接続の依頼が見つからないか、期限が切れています。"],
  ["version_conflict", "別の画面で先に版が作られています。最新の版を読み込んでから編集してください。"],
  ["edit_request_stale", "この箇所は、提案のあとに書き換えられたため、採用できません。"],
  ["not_open", "この提案は、すでに採用・却下・取り下げのどれかが済んでいます。最新の状態を読み込みました。"],
  ["not_requester", "取り下げられるのは、このリクエストを出した本人だけです。"],
  ["no_change", "元の文面と同じ提案が入っています。書き換えるか、取り除いてから送信してください。"],
  ["line_out_of_range", "提案の指している行が、本文の外にあります。最新の版に合わせてから、もう一度送信してください。"],
  ["not_rejected", "却下した提案だけを、未対応に戻せます。最新の状態を読み込みました。"],
  ["images_not_configured", "画像の置き場所が設定されていないため、アップロードできません。"],
  ["has_children", "子があるため外せません。先に子を移動してください。"],
  ["run_at_in_past", "過去の日時は指定できません。"],
  ["not_scheduled", "実行中または実行済みのため変更できません。"],
  ["wiki_key_taken", "この key はすでに使われています（アーカイブ中の wiki を含みます）。別の key を入力してください。"],
  ["wiki_not_found", "この wiki は見つかりません。アーカイブされたか、URL が違います。"],
  ["owner_only", "この操作は、オーナーだけが行えます。"],
  ["admin_only", "この操作は、この wiki の管理者だけが行えます。"],
  ["last_admin", "管理者が1人もいなくなるため、できません。先にほかのメンバーを管理者にしてください。"],
  ["last_owner", "最後のオーナーは解除できません。先にほかの人をオーナーにしてください。"],
  ["invite_used", "この招待リンクは、すでに使われています。"],
  ["invite_expired", "この招待リンクは、期限が切れています。"],
  ["invite_revoked", "この招待リンクは、無効にされています。"],
  ["invite_not_found", "この招待リンクは見つかりません。"],
  ["cycle", "自分自身や子孫の下には移動できません。"],
  ["x_not_configured", "この管理画面には、X の開発者アプリの設定がまだ登録されていないため、X と連携できません。"],
  ["sns_not_connected", "この wiki には、X のアカウントが連携されていません。先に「X と連携する」から連携してください。"],
  ["x_reauth_required", "X との連携が切れています（X の側で連携を外したか、許可の期限が切れました）。「X と連携し直す」から、もう一度許可してください。"],
  ["x_rate_limited", "X のポストの回数の上限に達しました。時間をおいて、もう一度お試しください。"],
  ["x_payment_required", "X の API の利用残高が足りません。X の開発者ポータルでクレジットを購入してから、もう一度お試しください。"],
  ["x_unavailable", "X に届きませんでした。時間をおいて、もう一度お試しください。"],
];

describe("errorMessage: 固定の文言", () => {
  it.each(FIXED_MESSAGES)("%s", (code, message) => {
    expect(err(code, "english message")).toBe(message);
    expect(err(code, "english message", { anything: 1 })).toBe(message);
  });
  it("固めた code は 30 個", () => {
    expect(new Set(FIXED_MESSAGES.map(([c]) => c)).size).toBe(30);
  });
});

describe("errorMessage: 未知の code と ApiError 以外", () => {
  it("未知の code は err.message をそのまま返す", () => {
    expect(err("something_new", "raw message")).toBe("raw message");
    expect(err("", "empty code")).toBe("empty code");
  });
  it("Object のプロパティ名と同じ code でも、err.message を返す", () => {
    for (const code of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(err(code, "raw message")).toBe("raw message");
    }
  });
  it("ApiError 以外は、Error なら message、それ以外は文字列にする", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

describe("errorMessage: invalid_input の details", () => {
  it("details が無い・配列でない・空のときは、確かめるよう促す", () => {
    const generic = "入力内容に誤りがあります。各項目を確かめて、もう一度お試しください。";
    expect(invalidInputMessage(undefined)).toBe(generic);
    expect(invalidInputMessage(null)).toBe(generic);
    expect(invalidInputMessage("x")).toBe(generic);
    expect(invalidInputMessage({ path: ["title"] })).toBe(generic);
    expect(invalidInputMessage([])).toBe(generic);
    expect(invalidInputMessage([{ path: ["unknown"] }, { path: "title" }, { path: [1] }, {}])).toBe(generic);
    expect(err("invalid_input", "invalid input", [])).toBe(generic);
  });
  it("title は too_small で空の案内、それ以外は上限", () => {
    expect(invalidInputMessage([{ code: "too_small", path: ["title"] }])).toBe("タイトルを入れてください。");
    expect(invalidInputMessage([{ code: "too_big", path: ["title"] }])).toBe(`タイトルは${PAGE_TITLE_MAX}字までです。短くしてください。`);
    expect(invalidInputMessage([{ path: ["title"] }])).toBe(`タイトルは${PAGE_TITLE_MAX}字までです。短くしてください。`);
  });
  it("bodyMd は本文の案内", () => {
    expect(invalidInputMessage([{ code: "too_small", path: ["bodyMd"] }])).toBe("本文の内容に誤りがあります。確かめて、もう一度お試しください。");
  });
  it("複数あるときは、知っている項目のうち最初のものを使う", () => {
    expect(invalidInputMessage([{ path: ["unknown"] }, { code: "too_small", path: ["bodyMd"] }, { code: "too_small", path: ["title"] }])).toBe(
      "本文の内容に誤りがあります。確かめて、もう一度お試しください。",
    );
    expect(invalidInputMessage([{ code: "too_small", path: ["title", 0] }, { path: ["bodyMd"] }])).toBe("タイトルを入れてください。");
  });
});

describe("errorMessage: draft_conflict", () => {
  const tail = "がこの箇所を編集中のため、採用できません。編集が版になるのを待つか、本人に確かめてください。";
  it("編集中の人が無ければ「ほかの人」", () => {
    expect(err("draft_conflict", "m")).toBe(`ほかの人${tail}`);
    expect(err("draft_conflict", "m", {})).toBe(`ほかの人${tail}`);
    expect(err("draft_conflict", "m", { editors: [] })).toBe(`ほかの人${tail}`);
  });
  it("1 人なら名前、複数なら「、」でつなぐ", () => {
    expect(err("draft_conflict", "m", { editors: [{ name: "A" }] })).toBe(`A さん${tail}`);
    expect(err("draft_conflict", "m", { editors: [{ name: "A" }, { name: "B" }, { name: "C" }] })).toBe(`A、B、C さん${tail}`);
  });
});

describe("errorMessage: 画像の条件", () => {
  it("image_too_large: details.limit が文字列ならそれ、でなければ既定", () => {
    expect(err("image_too_large", "m", { limit: "PNG は 512KB まで" })).toBe("画像が大きすぎます。PNG は 512KB までです。");
    for (const d of [undefined, {}, { limit: 5 }, { limit: null }]) {
      expect(err("image_too_large", "m", d)).toBe(`画像が大きすぎます。${IMAGE_LIMIT_LABEL}です。`);
    }
  });
  it("unsupported_image_type: 同じ規則", () => {
    expect(err("unsupported_image_type", "m", { limit: "PNG だけ" })).toBe("この形式の画像はアップロードできません。PNG だけです。");
    for (const d of [undefined, {}, { limit: 5 }]) {
      expect(err("unsupported_image_type", "m", d)).toBe(`この形式の画像はアップロードできません。${IMAGE_LIMIT_LABEL}です。`);
    }
  });
});

describe("errorMessage: x_rejected", () => {
  const rest = "。同じ文面を続けてポストすると断られます。文面を変えて、もう一度お試しください。";
  it("details.detail が空でない文字列のときだけ説明を付ける", () => {
    expect(err("x_rejected", "m", { detail: "Duplicate content" })).toBe(`X がこのポストを受け付けませんでした（X からの説明：Duplicate content）${rest}`);
    for (const d of [undefined, {}, { detail: "" }, { detail: 1 }, { detail: null }]) {
      expect(err("x_rejected", "m", d)).toBe(`X がこのポストを受け付けませんでした${rest}`);
    }
  });
});

describe("errorMessage: exceeds_parent", () => {
  const tail = "それより広い公開範囲にはできません。先に親ページを公開するか、このページの公開範囲を狭めてください。";
  it("details が無ければ、親ページ・より狭い公開範囲", () => {
    expect(err("exceeds_parent", "m")).toBe(`親ページがより狭い公開範囲のため、${tail}`);
    expect(err("exceeds_parent", "m", {})).toBe(`親ページがより狭い公開範囲のため、${tail}`);
  });
  it("親のタイトルと公開範囲を入れる", () => {
    expect(err("exceeds_parent", "m", { parentTitle: "親", parentVisibility: "private" })).toBe(`親ページ「親」が非公開のため、${tail}`);
    expect(err("exceeds_parent", "m", { parentTitle: "親", parentVisibility: "unlisted" })).toBe(`親ページ「親」が限定公開のため、${tail}`);
    expect(err("exceeds_parent", "m", { parentVisibility: "public" })).toBe(`親ページが公開のため、${tail}`);
    expect(err("exceeds_parent", "m", { parentTitle: "", parentVisibility: "private" })).toBe(`親ページが非公開のため、${tail}`);
    expect(err("exceeds_parent", "m", { parentTitle: "親" })).toBe(`親ページ「親」がより狭い公開範囲のため、${tail}`);
  });
});

describe("errorMessage: descendants_wider", () => {
  const mk = (n: string) => `配下に、それより広い公開範囲のページが${n}あります。配下のページもまとめて変えるか、先に配下のページを狭めてください。`;
  it("件数があれば入れる。無い・0 なら入れない", () => {
    expect(err("descendants_wider", "m", { count: 3 })).toBe(mk(" 3 件"));
    for (const d of [undefined, {}, { count: 0 }]) expect(err("descendants_wider", "m", d)).toBe(mk(""));
  });
});
