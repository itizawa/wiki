import { describe, expect, it } from "vitest";
import { resolveManifestSource } from "./manifest-source.mjs";

const api = { API_ORIGIN: "https://api.test", EXPORT_TOKEN: "t" };

describe("resolveManifestSource", () => {
  it("fetches from the API on the production branch and outside Workers Builds", () => {
    const expected = { kind: "api", origin: "https://api.test", token: "t" };
    expect(resolveManifestSource({ ...api, WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" })).toEqual(expected);
    expect(resolveManifestSource(api)).toEqual(expected);
    expect(resolveManifestSource({ ...api, WORKERS_CI_BRANCH: "" })).toEqual(expected);
  });

  it("uses the sample data on any other branch, even when the token is there", () => {
    expect(resolveManifestSource({ ...api, WORKERS_CI: "1", WORKERS_CI_BRANCH: "renovate/astro-5.x" })).toEqual({
      kind: "sample",
      branch: "renovate/astro-5.x",
    });
    expect(resolveManifestSource({ WORKERS_CI_BRANCH: "feature" })).toEqual({ kind: "sample", branch: "feature" });
  });

  it("fails on the production branch without the token, instead of falling back to the sample data", () => {
    expect(resolveManifestSource({ API_ORIGIN: "https://api.test", WORKERS_CI_BRANCH: "main" }).kind).toBe("error");
    expect(resolveManifestSource({ EXPORT_TOKEN: "t", WORKERS_CI_BRANCH: "main" }).kind).toBe("error");
    expect(resolveManifestSource({}).kind).toBe("error");
  });

  it("does not accept the old name of the token", () => {
    expect(resolveManifestSource({ API_ORIGIN: "https://api.test", INTERNAL_TOKEN: "t" }).kind).toBe("error");
  });

  it("leaves a given MANIFEST_PATH alone, on any branch", () => {
    expect(resolveManifestSource({ MANIFEST_PATH: "fixtures/manifest.sample.json", WORKERS_CI_BRANCH: "main" })).toEqual({ kind: "file" });
    expect(resolveManifestSource({ ...api, MANIFEST_PATH: "x.json", WORKERS_CI_BRANCH: "feature" })).toEqual({ kind: "file" });
  });
});
