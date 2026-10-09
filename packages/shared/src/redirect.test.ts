import { describe, expect, it } from "vitest";
import { resolvePagePath } from "./redirect";
import { isoToJstLocal, jstDate, jstLocalToIso } from "./time";

const routes = { canonical: { abcdefghij: "/p/abcdefghij-hello/" }, gone: ["zzzzzzzzzz"] };

describe("resolvePagePath", () => {
  it("redirects a wrong or missing slug to the canonical URL", () => {
    expect(resolvePagePath("/p/abcdefghij-old", routes)).toEqual({ status: 301, location: "/p/abcdefghij-hello/" });
    expect(resolvePagePath("/p/abcdefghij", routes)).toEqual({ status: 301, location: "/p/abcdefghij-hello/" });
  });

  it("does nothing for the canonical URL itself", () => {
    expect(resolvePagePath("/p/abcdefghij-hello/", routes)).toBeNull();
    expect(resolvePagePath("/p/abcdefghij-hello", routes)).toBeNull();
  });

  it("returns 410 for deleted articles and null for unknown ones", () => {
    expect(resolvePagePath("/p/zzzzzzzzzz-x", routes)).toEqual({ status: 410 });
    expect(resolvePagePath("/p/yyyyyyyyyy-x", routes)).toBeNull();
    expect(resolvePagePath("/t/main/", routes)).toBeNull();
  });
});

describe("JST helpers", () => {
  it("converts between JST wall time and UTC", () => {
    const iso = jstLocalToIso("2026-10-10T07:00");
    expect(new Date(iso).toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(isoToJstLocal("2026-10-09T22:00:00.000Z")).toBe("2026-10-10T07:00");
    expect(jstDate("2026-10-09T22:00:00.000Z")).toBe("2026-10-10");
  });
});
