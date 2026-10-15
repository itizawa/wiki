import { AUDIO_MAX_BYTES, AUDIO_MAX_PER_PAGE, AUDIO_NAME_MAX, audioObjectName, durationMsOf, sniffAudioType, type AudioType } from "@wiki/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { auditActor, writeAudit } from "../audit/service";
import { pageAudio, pages } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { readBodyUpTo } from "../images/upload";
import { findLivePage } from "../routes/pages";
import { verifyAudioUrl } from "./sign";
import { countPageAudio, deleteAudioObjects, findPageAudio, listPageAudio, objectNameOf } from "./service";
import type { AudioStore } from "./store";

function requireStore(store: AudioStore | null | undefined): AudioStore {
  if (!store) throw new HttpError(503, "audio_not_configured", "audio storage is not configured");
  return store;
}

/** 音声を返す応答。ログインした人か、署名つきの URL を持つ人にだけ返すものなので、キャッシュさせない */
function audioResponse(file: { body: ReadableStream | Uint8Array }, contentType: string, name: string, disposition: "inline" | "attachment"): Response {
  return new Response(file.body as BodyInit, {
    headers: {
      "content-type": contentType,
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/** `?name=` のファイル名。パスの区切りより前は捨て、長すぎれば切る。空なら「音声」 */
function cleanName(raw: string | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  return Array.from(base).slice(0, AUDIO_NAME_MAX).join("") || "音声";
}

/**
 * ページの音声（wiki のメンバーなら、編集者以上のだれでも）。`/admin/w/{key}/pages` の下に置く。
 * アップロードの本文はファイルの中身そのまま（multipart にしない）。ファイル名は `?name=`、長さは `?durationMs=`（ブラウザが測れたときだけ）。
 * 別の wiki のページ・ゴミ箱のページは 404。
 */
export const pageAudioRoutes = new Hono<AppEnv>()
  .get("/:pageId/audio", async (c) => {
    const { db } = c.get("deps");
    const page = await findLivePage(db, c.get("wiki").id, c.req.param("pageId"));
    return c.json({ audio: await listPageAudio(db, page.id) });
  })
  .post("/:pageId/audio", async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const store = requireStore(deps.audio);
    const wikiId = c.get("wiki").id;
    const page = await findLivePage(db, wikiId, c.req.param("pageId"));
    if ((await countPageAudio(db, page.id)) >= AUDIO_MAX_PER_PAGE) {
      throw new HttpError(409, "too_many_audio", `a page can hold at most ${AUDIO_MAX_PER_PAGE} audio files`, { max: AUDIO_MAX_PER_PAGE });
    }
    const tooLarge = () => new HttpError(413, "audio_too_large", `audio must be ${AUDIO_MAX_BYTES} bytes or smaller`, { maxBytes: AUDIO_MAX_BYTES });
    const body = await readBodyUpTo(c.req.raw, AUDIO_MAX_BYTES, tooLarge);
    const type = sniffAudioType(body);
    if (!type) throw new HttpError(415, "unsupported_audio_type", "only WebM, M4A (MP4), MP3 and WAV audio is accepted");
    const name = cleanName(c.req.query("name"));
    const durationMs = durationMsOf(c.req.query("durationMs"));
    const id = crypto.randomUUID();
    const objectName = audioObjectName(id, type);
    // 置き場所に置いてから行を足す。行を足せなかったら、置いたものを消す（残っても、日次の掃除が拾う）
    await store.put(objectName, body, type);
    try {
      await db.transaction(async (tx) => {
        await tx.insert(pageAudio).values({ id, wikiId, pageId: page.id, name, contentType: type, bytes: body.byteLength, durationMs, createdBy: c.get("user").id });
        await writeAudit(tx, {
          wikiId,
          actor: auditActor(c),
          action: "page_audio_upload",
          target: { type: "page", id: page.id, label: page.title },
          detail: { name, bytes: body.byteLength },
        });
      });
    } catch (err) {
      await deleteAudioObjects(store, [objectName]);
      throw err;
    }
    const added = (await listPageAudio(db, page.id)).find((a) => a.id === id)!;
    return c.json(added, 201);
  })
  // 取り出し。管理画面のログイン（Cookie）でだけ（`/admin` の下なので、署名つきの URL では来られない）
  .get("/:pageId/audio/:id", async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const page = await findLivePage(db, c.get("wiki").id, c.req.param("pageId"));
    const row = await findPageAudio(db, page.id, c.req.param("id"));
    const file = row && deps.audio ? await deps.audio.get(objectNameOf(row)) : null;
    if (!row || !file) throw notFound("audio");
    return audioResponse(file, row.contentType, row.name, "inline");
  })
  .delete("/:pageId/audio/:id", async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const wikiId = c.get("wiki").id;
    const page = await findLivePage(db, wikiId, c.req.param("pageId"));
    const row = await findPageAudio(db, page.id, c.req.param("id"));
    if (!row) throw notFound("audio");
    await db.transaction(async (tx) => {
      await tx.delete(pageAudio).where(eq(pageAudio.id, row.id));
      await writeAudit(tx, {
        wikiId,
        actor: auditActor(c),
        action: "page_audio_delete",
        target: { type: "page", id: page.id, label: page.title },
        detail: { name: row.name },
      });
    });
    await deleteAudioObjects(deps.audio, [objectNameOf(row)]);
    return c.json({ ok: true });
  });

/**
 * 署名つきの取り出し（`GET /audio/{id}?exp=&sig=`）。MCP の `list_page_audio` が返す URL で、ログインは要らない。
 * 署名が違う・期限が切れた・音声が無い（削除した・ページを完全に削除した）・ページがゴミ箱にある、はどれも同じ 404 にする。
 */
export const audioSignedRoutes = new Hono<AppEnv>().get("/:id", async (c) => {
  const deps = c.get("deps");
  const id = c.req.param("id");
  if (!(await verifyAudioUrl(deps.config.sessionSecret, id, c.req.query("exp"), c.req.query("sig")))) throw notFound("audio");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("audio");
  const [row] = await deps.db
    .select({ audio: pageAudio })
    .from(pageAudio)
    .innerJoin(pages, eq(pages.id, pageAudio.pageId))
    .where(and(eq(pageAudio.id, id), isNull(pages.deletedAt)));
  const file = row && deps.audio ? await deps.audio.get(objectNameOf(row.audio)) : null;
  if (!row || !file) throw notFound("audio");
  return audioResponse(file, row.audio.contentType as AudioType, row.audio.name, "attachment");
});
