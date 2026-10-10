import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./CodeBlockMenu";
import { lowlight } from "./highlight";

describe("コードブロックの色分け", () => {
  it("言語の選択肢は、すべて色分けできる", () => {
    for (const { value } of LANGUAGES) expect(lowlight.registered(value), value).toBe(true);
  });

  it("言語を選んでいないブロック（plaintext）は、色を付けない", () => {
    expect(lowlight.registered("plaintext")).toBe(true);
    expect(lowlight.highlight("plaintext", "const a = 1;").children.every((c) => c.type === "text")).toBe(true);
  });
});
