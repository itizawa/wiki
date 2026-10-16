import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONSENT_MISSING_HEADING } from "./ConsentPage";

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

describe("/consent の「依頼が見つかりません」", () => {
  it("外部アプリ連携とトップへのリンクがある", () => {
    const src = read("./ConsentPage.tsx");
    const block = src.slice(src.indexOf('if (request === "")'), src.indexOf("if (info.isPending)"));
    expect(CONSENT_MISSING_HEADING).toBe("接続の依頼が見つかりません");
    expect(block).toContain('to="/connections"');
    expect(block).toContain('<RouterLink to="/">');
  });
});

describe("/invite の使えないリンクの画面", () => {
  it("3 つの画面すべてが、新しいリンクの頼み方とトップへのリンクを出す", () => {
    const src = read("./InvitePage.tsx");
    expect(src.match(/<AskForNewLink \/>/g)).toHaveLength(3);
    expect(src).toContain("招待した人に、新しい招待リンクを頼んでください。");
    expect(src).toContain('<RouterLink to="/">管理画面のトップへ</RouterLink>');
  });
});
