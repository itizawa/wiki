import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setApiWiki } from "./api";

const fetchMock = vi.fn();

const respond = (status: number, body: string, statusText = "") => new Response(body, { status, statusText });
const jsonOk = (data: unknown = {}) => respond(200, JSON.stringify(data));
const calledPath = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1]![0] as string;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setApiWiki("docs");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query strings sent by the list APIs", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => jsonOk());
  });

  describe("listPagesPage", () => {
    it("always sends limit, in the order limit, q, cursor", async () => {
      await api.listPagesPage({ q: "foo bar", cursor: "c1", limit: 20 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=20&q=foo+bar&cursor=c1");
    });
    it("drops empty and missing q and cursor", async () => {
      await api.listPagesPage({ q: "", cursor: null, limit: 5 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=5");
      await api.listPagesPage({ limit: 5 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=5");
    });
    it("keeps limit 0", async () => {
      await api.listPagesPage({ limit: 0 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=0");
    });
    it("sends tags comma-separated and the order", async () => {
      await api.listPagesPage({ limit: 5, tag: ["t1", "t2"], order: "asc" });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=5&tag=t1%2Ct2&order=asc");
      await api.listPagesPage({ limit: 5, tag: [] });
      expect(calledPath()).toBe("/api/admin/w/docs/pages?limit=5");
    });
  });

  describe("listVersions", () => {
    it("sends limit then cursor", async () => {
      await api.listVersions("p1", { cursor: "c/1", limit: 30 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages/p1/versions?limit=30&cursor=c%2F1");
    });
    it("drops empty, null and undefined cursor but keeps limit 0", async () => {
      await api.listVersions("p1", { cursor: "", limit: 0 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages/p1/versions?limit=0");
      await api.listVersions("p1", { cursor: null, limit: 1 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages/p1/versions?limit=1");
      await api.listVersions("p1", { limit: 1 });
      expect(calledPath()).toBe("/api/admin/w/docs/pages/p1/versions?limit=1");
    });
  });

  describe("listWikiEditRequests", () => {
    it("sends status, limit, then cursor", async () => {
      await api.listWikiEditRequests({ status: ["open"], cursor: "abc", limit: 10 });
      expect(calledPath()).toBe("/api/admin/w/docs/edit-requests?status=open&limit=10&cursor=abc");
    });
    it("sends several statuses comma-separated", async () => {
      await api.listWikiEditRequests({ status: ["open", "done"], limit: 10 });
      expect(calledPath()).toBe("/api/admin/w/docs/edit-requests?status=open%2Cdone&limit=10");
    });
    it("drops empty and null cursor", async () => {
      await api.listWikiEditRequests({ status: ["open"], cursor: "", limit: 10 });
      expect(calledPath()).toBe("/api/admin/w/docs/edit-requests?status=open&limit=10");
      await api.listWikiEditRequests({ status: ["open"], cursor: null, limit: 0 });
      expect(calledPath()).toBe("/api/admin/w/docs/edit-requests?status=open&limit=0");
    });
  });

  describe("listSchedule", () => {
    it("has no query string without params", async () => {
      await api.listSchedule();
      expect(calledPath()).toBe("/api/admin/w/docs/schedule");
      await api.listSchedule({});
      expect(calledPath()).toBe("/api/admin/w/docs/schedule");
    });
    it("keeps the key order of the given object", async () => {
      await api.listSchedule({ from: "2026-01-01", to: "2026-02-01", pageId: "p1", status: "pending" });
      expect(calledPath()).toBe("/api/admin/w/docs/schedule?from=2026-01-01&to=2026-02-01&pageId=p1&status=pending");
      await api.listSchedule({ status: "pending", from: "a b" });
      expect(calledPath()).toBe("/api/admin/w/docs/schedule?status=pending&from=a+b");
    });
    it("drops empty strings and undefined", async () => {
      await api.listSchedule({ from: "", to: undefined, pageId: "p1", status: "" });
      expect(calledPath()).toBe("/api/admin/w/docs/schedule?pageId=p1");
      await api.listSchedule({ from: "", status: "" });
      expect(calledPath()).toBe("/api/admin/w/docs/schedule");
    });
    it("drops 0 and null that sneak past the types", async () => {
      await api.listSchedule({ from: 0, to: null, pageId: "p1" } as never);
      expect(calledPath()).toBe("/api/admin/w/docs/schedule?pageId=p1");
    });
  });

  describe("listAuditLogs", () => {
    it("sends the period and order first, then people, categories and wikis comma-separated, then cursor", async () => {
      await api.listAuditLogs("wiki", { actor: ["u1", "u2"], from: "2026-01-01", category: ["page"], order: "asc" }, "cur");
      expect(calledPath()).toBe("/api/admin/w/docs/audit-logs?from=2026-01-01&order=asc&actor=u1%2Cu2&category=page&cursor=cur");
    });
    it("uses the all-scope path", async () => {
      await api.listAuditLogs("all", { wiki: ["global", "docs"] });
      expect(calledPath()).toBe("/api/admin/audit-logs?wiki=global%2Cdocs");
    });
    it("has no query string when everything is empty", async () => {
      await api.listAuditLogs("wiki", {});
      expect(calledPath()).toBe("/api/admin/w/docs/audit-logs");
      await api.listAuditLogs("all", { from: "", to: undefined, actor: [] }, "");
      expect(calledPath()).toBe("/api/admin/audit-logs");
    });
    it("drops empty values among set ones", async () => {
      await api.listAuditLogs("wiki", { from: "", to: "2026-02-01", actor: [], category: undefined }, undefined);
      expect(calledPath()).toBe("/api/admin/w/docs/audit-logs?to=2026-02-01");
    });
    it("encodes values", async () => {
      await api.listAuditLogs("all", { actor: ["a&b=c"] });
      expect(calledPath()).toBe("/api/admin/audit-logs?actor=a%26b%3Dc");
    });
  });
});

describe("request error handling", () => {
  it("returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(jsonOk({ pages: [1] }));
    await expect(api.listPages()).resolves.toEqual({ pages: [1] });
  });
  it("returns null for an empty successful body", async () => {
    fetchMock.mockResolvedValue(respond(200, ""));
    await expect(api.listPages()).resolves.toBeNull();
  });
  it("builds an ApiError from the error envelope", async () => {
    fetchMock.mockResolvedValue(respond(409, JSON.stringify({ error: { code: "version_conflict", message: "m", details: { a: 1 } } }), "Conflict"));
    const e = await api.listPages().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "version_conflict", message: "m", details: { a: 1 } });
  });
  it("falls back to code 'error' and statusText when the envelope is partial", async () => {
    fetchMock.mockResolvedValue(respond(500, JSON.stringify({}), "Server Error"));
    const e = await api.listPages().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 500, code: "error", message: "Server Error" });
    expect(e.details).toBeUndefined();
  });
  it("falls back when the error body is empty (null)", async () => {
    fetchMock.mockResolvedValue(respond(502, "", "Bad Gateway"));
    const e = await api.listPages().catch((x) => x);
    expect(e).toMatchObject({ status: 502, code: "error", message: "Bad Gateway" });
  });
  it("throws SyntaxError, not ApiError, when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(respond(502, "<html>bad</html>", "Bad Gateway"));
    const e = await api.listPages().catch((x) => x);
    expect(e).toBeInstanceOf(SyntaxError);
    expect(e).not.toBeInstanceOf(ApiError);
  });
  it("throws SyntaxError when a successful body is not JSON", async () => {
    fetchMock.mockResolvedValue(respond(200, "nope"));
    await expect(api.listPages()).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("upload error handling", () => {
  const file = new Blob(["x"], { type: "image/png" });
  it("returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(jsonOk({ url: "/images/a.png" }));
    await expect(api.uploadImage(file)).resolves.toEqual({ url: "/images/a.png" });
    expect(calledPath()).toBe("/api/admin/w/docs/images");
  });
  it("builds an ApiError from the error envelope", async () => {
    fetchMock.mockResolvedValue(respond(413, JSON.stringify({ error: { code: "too_large", message: "big", details: [1] } }), "Payload Too Large"));
    const e = await api.uploadImage(file).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 413, code: "too_large", message: "big", details: [1] });
  });
  it("gives code 'error' and statusText when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(respond(502, "<html>", "Bad Gateway"));
    const e = await api.uploadImage(file).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, code: "error", message: "Bad Gateway" });
    expect(e.details).toBeUndefined();
  });
  it("gives code 'error' and statusText when the error body is empty", async () => {
    fetchMock.mockResolvedValue(respond(500, "", "Server Error"));
    const e = await api.uploadImage(file).catch((x) => x);
    expect(e).toMatchObject({ status: 500, code: "error", message: "Server Error" });
  });
});
