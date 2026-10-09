import type { ManifestPage, ManifestTree, PublicManifest } from "@wiki/shared";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let cached: Promise<PublicManifest> | undefined;

/** MANIFEST_PATH（なければ scripts/fetch-manifest.mjs が保存した .manifest.json）を読む。 */
export function manifestPath(): string {
  return resolve(process.env.MANIFEST_PATH ?? ".manifest.json");
}

export function loadManifest(): Promise<PublicManifest> {
  cached ??= readFile(manifestPath(), "utf8").then((text) => JSON.parse(text) as PublicManifest);
  return cached;
}

export type SiteData = {
  manifest: PublicManifest;
  pagesById: Map<string, ManifestPage>;
  primaryTree: ManifestTree | undefined;
};

export async function siteData(): Promise<SiteData> {
  const manifest = await loadManifest();
  return {
    manifest,
    pagesById: new Map(manifest.pages.map((p) => [p.id, p])),
    primaryTree: manifest.trees.find((t) => t.isPrimary) ?? manifest.trees[0],
  };
}

export const SITE_NAME = process.env.SITE_NAME ?? "wiki";
