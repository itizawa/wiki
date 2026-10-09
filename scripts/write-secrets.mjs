// デプロイ用：環境変数から wrangler の --secrets-file に渡すJSONを書き出す。
// 使い方: node write-secrets.mjs <出力先> KEY [KEY ...]    （KEY? は未設定でもよい）
// 必須のキーが空ならここで止める（空のシークレットでデプロイしないため）。
import { writeFileSync } from "node:fs";

const [out, ...keys] = process.argv.slice(2);
if (!out || keys.length === 0) {
  console.error("usage: write-secrets.mjs <out.json> KEY [KEY? ...]");
  process.exit(1);
}

const secrets = {};
const missing = [];
for (const spec of keys) {
  const optional = spec.endsWith("?");
  const key = optional ? spec.slice(0, -1) : spec;
  const value = process.env[key];
  if (value) secrets[key] = value;
  else if (!optional) missing.push(key);
}
if (missing.length > 0) {
  console.error(`missing secrets: ${missing.join(", ")}（GitHub の Settings → Secrets and variables → Actions に登録する）`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
console.log(`wrote ${Object.keys(secrets).length} secrets: ${Object.keys(secrets).join(", ")}`);
