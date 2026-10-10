import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions";
import { createFindPlugin, findKey, replaceAll, replaceCurrent, setQuery, step } from "./findPlugin";

function setup(md: string) {
  const editor = new Editor({ element: null, extensions: editorExtensions, content: md, contentType: "markdown" });
  editor.registerPlugin(createFindPlugin());
  const dispatch = (tr: ReturnType<typeof setQuery> | null) => tr && editor.view.dispatch(tr);
  const state = () => findKey.getState(editor.state)!;
  return { editor, dispatch, state };
}

describe("本文の検索と置換", () => {
  it("大文字・小文字を区別せず、段落や見出しをまたいで数える", () => {
    const { editor, dispatch, state } = setup("# Wiki の使い方\n\nwiki に書く。**WIKI** を読む。");
    dispatch(setQuery(editor.state.tr, "wiki"));
    expect(state().matches).toHaveLength(3);
    expect(state().index).toBe(0);
  });

  it("次へ・前へは端で反対側に回る", () => {
    const { editor, dispatch, state } = setup("a a a");
    dispatch(setQuery(editor.state.tr, "a"));
    dispatch(step(editor.state, -1));
    expect(state().index).toBe(2);
    dispatch(step(editor.state, 1));
    expect(state().index).toBe(0);
  });

  it("1つだけ置き換えると、残りの一致が続けて選ばれる", () => {
    const { editor, dispatch, state } = setup("猫と猫と猫");
    dispatch(setQuery(editor.state.tr, "猫"));
    dispatch(replaceCurrent(editor.state, "犬"));
    expect(editor.getMarkdown().trim()).toBe("犬と猫と猫");
    expect(state().matches).toHaveLength(2);
  });

  it("すべて置き換える。空にすれば削除になる", () => {
    const { editor, dispatch, state } = setup("猫と**猫**と猫");
    dispatch(setQuery(editor.state.tr, "猫"));
    dispatch(replaceAll(editor.state, "いぬ"));
    expect(editor.getMarkdown().trim()).toBe("いぬと**いぬ**といぬ");
    expect(state().matches).toHaveLength(0);
    dispatch(setQuery(editor.state.tr, "と"));
    dispatch(replaceAll(editor.state, ""));
    expect(editor.getMarkdown().trim()).toBe("いぬ**いぬ**いぬ");
  });
});
