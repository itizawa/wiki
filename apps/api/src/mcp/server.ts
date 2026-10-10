import { StructureOpError, StructureValidationError } from "@wiki/shared";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { authenticateAccessToken, type AgentContext } from "../oauth/service";
import { callTool, toolsFor } from "./tools";

/** 対応する MCP の版。クライアントが求めた版がこの中にあればそれを、無ければ先頭を返す */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25", "2025-03-26"];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcRequest["id"] | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function unauthorized(c: Context<AppEnv>, error?: string) {
  const { config } = c.get("deps");
  const params = [`resource_metadata="${config.adminOrigin}/.well-known/oauth-protected-resource/mcp"`];
  if (error) params.push(`error="${error}"`);
  c.header("www-authenticate", `Bearer ${params.join(", ")}`);
  return c.json({ error: { code: "unauthenticated", message: "a valid access token is required" } }, 401);
}

/**
 * /mcp：MCP サーバー（Streamable HTTP、セッションを持たない）。認証は OAuth 2.1 のアクセストークンだけで、Cookie は見ない。
 * 応答は SSE にせず、JSON で返す。
 */
export const mcpRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const { db, config } = c.get("deps");
    // DNS リバインディング対策：ブラウザからの呼び出しは管理画面のオリジンだけ
    const origin = c.req.header("origin");
    if (origin && origin !== config.adminOrigin) {
      return c.json({ error: { code: "bad_origin", message: "cross-origin request rejected" } }, 403);
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) return unauthorized(c);
    const agent = await authenticateAccessToken(db, config, token);
    if (agent === null) return unauthorized(c, "invalid_token");
    if (agent === "rate_limited") {
      return c.json({ error: { code: "rate_limited", message: "too many requests" } }, 429, { "retry-after": "60" });
    }

    let msg: JsonRpcRequest;
    try {
      msg = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, "parse error"), 400);
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return c.json(rpcError(null, -32600, "invalid request"), 400);
    }
    // 通知（id なし）には応答を返さない
    if (msg.id === undefined) return c.body(null, 202);
    return c.json(await handle(c, agent, msg));
  })
  // サーバーからの SSE は出さない
  .get("/", (c) => c.body(null, 405, { allow: "POST" }))
  .delete("/", (c) => c.body(null, 405, { allow: "POST" }));

async function handle(c: Context<AppEnv>, agent: AgentContext, msg: JsonRpcRequest) {
  const { db, config } = c.get("deps");
  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "wiki", version: "1.0.0" },
        instructions:
          "wiki のページを探して読み、作成・更新・移動できる。許可されていれば、公開・予約・削除もできる（使える道具は tools/list のとおり）。" +
          "本文の更新は get_page の headVersionId を、移動は get_tree の headCommitId を渡す（楽観ロック）。",
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, {
        tools: toolsFor(agent).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string") return rpcError(msg.id, -32602, "params.name is required");
      try {
        const result = await callTool({ db, config, agent }, name, msg.params?.arguments);
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (err) {
        // 道具の失敗は、エージェントが読んでやり直せるように結果として返す
        const failure = describeError(err);
        if (!failure) throw err;
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify({ error: failure }, null, 2) }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

function describeError(err: unknown): { code: string; message: string; details?: unknown } | null {
  if (err instanceof HttpError) return { code: err.code, message: err.message, details: err.details };
  if (err instanceof StructureOpError) return { code: err.code, message: err.message };
  if (err instanceof StructureValidationError) return { code: "invalid_structure", message: err.message };
  return null;
}
