import { describe, expect, it } from "vitest";
import { httpsUrlOrNull } from "../auth/google";

describe("httpsUrlOrNull", () => {
  it("accepts only https URLs", () => {
    expect(httpsUrlOrNull("https://lh3.googleusercontent.com/a/x")).toBe("https://lh3.googleusercontent.com/a/x");
    expect(httpsUrlOrNull("http://example.com/a.png")).toBeNull();
    expect(httpsUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(httpsUrlOrNull("data:image/png;base64,AAAA")).toBeNull();
    expect(httpsUrlOrNull("not a url")).toBeNull();
    expect(httpsUrlOrNull(undefined)).toBeNull();
    expect(httpsUrlOrNull(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});
