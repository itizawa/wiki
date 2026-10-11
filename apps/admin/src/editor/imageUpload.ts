import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { api, errorMessage } from "../lib/api";
import { imageFileProblem } from "./imageFile";

/** 貼り付け・ドロップされたもののうち、画像のファイル。画像が無ければ空（文字などの貼り付けはふつうに扱う） */
export function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((f) => f.type.startsWith("image/"));
}

type Meta = { add: { id: object; pos: number } } | { remove: { id: object } };

const key = new PluginKey<DecorationSet>("imageUpload");

/** アップロード中の画像の目印（編集で位置がずれても追いかける）の、いまの位置 */
function placeholderPos(state: EditorState, id: object): number | null {
  const found = key.getState(state)?.find(undefined, undefined, (spec) => spec.id === id);
  return found?.[0]?.from ?? null;
}

function placeholder(): HTMLElement {
  const el = document.createElement("span");
  el.className = "image-uploading";
  el.setAttribute("role", "status");
  el.textContent = "画像をアップロード中…";
  return el;
}

/**
 * 画像をアップロードして、pos の位置に入れる。アップロードの間は、その位置に「アップロード中」の目印を出す。
 * 失敗したら目印を消して onError に理由を渡す。
 */
export function uploadImages(editor: Editor, files: File[], pos: number, onError: (message: string) => void) {
  for (const file of files) {
    const problem = imageFileProblem(file);
    if (problem) {
      onError(problem);
      continue;
    }
    const id = {};
    const view: EditorView = editor.view;
    view.dispatch(view.state.tr.setMeta(key, { add: { id, pos } } satisfies Meta));
    api.uploadImage(file).then(
      ({ url }) => {
        if (editor.isDestroyed) return;
        const at = placeholderPos(editor.state, id);
        editor.view.dispatch(editor.state.tr.setMeta(key, { remove: { id } } satisfies Meta));
        // 目印のあった段落ごと消されていたら、入れない
        if (at === null) return;
        editor.chain().insertContentAt(at, { type: "image", attrs: { src: url, alt: "" } }).run();
      },
      (err: unknown) => {
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: { id } } satisfies Meta));
        onError(`画像をアップロードできませんでした。${errorMessage(err)}`);
      },
    );
  }
}

export type ImageUploadOptions = { onError: (message: string) => void };

/** 画像の貼り付けとドラッグ＆ドロップで、アップロードして本文に入れる。 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: "imageUpload",
  addOptions() {
    return { onError: () => {} };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const onError = (message: string) => this.options.onError(message);
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta && "add" in meta) {
              next = next.add(tr.doc, [Decoration.widget(meta.add.pos, placeholder, { id: meta.add.id })]);
            } else if (meta && "remove" in meta) {
              next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove.id));
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
          handlePaste(view, event) {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            uploadImages(editor, files, view.state.selection.from, onError);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
            uploadImages(editor, files, pos, onError);
            return true;
          },
        },
      }),
    ];
  },
});
