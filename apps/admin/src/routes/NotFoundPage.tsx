import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Muted, PageBody, RouterLink, Section } from "../components/ui";
import { DEFAULT_DOCUMENT_TITLE, useDocumentTitle } from "../lib/documentTitle";
import { Center } from "./Layout";

export const NOT_FOUND_HEADING = "ページが見つかりません";

/** 画面の名前（タブの題・履歴に出る）。 */
export function notFoundTitle(): string {
  return `${NOT_FOUND_HEADING} - ${DEFAULT_DOCUMENT_TITLE}`;
}

/**
 * 管理画面に無い経路を開いたときの画面。何が起きたかと、戻り先を出す。
 * `/w/{key}/...` の中では本文の場所に出し（サイドバーはそのまま）、外では画面いっぱいに出す。
 * 表示したら、見出しにフォーカスを移し、タブの題も変える（読み上げでも何が起きたかわかるように）。
 */
export function NotFoundPage() {
  const { wikiKey } = useParams({ strict: false });
  const heading = useRef<HTMLHeadingElement>(null);

  useDocumentTitle(notFoundTitle());
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const content = (
    <Stack spacing={1.5} sx={wikiKey ? undefined : { alignItems: "center" }}>
      <Typography variant="h5" component="h1" ref={heading} tabIndex={-1} sx={{ outline: "none" }}>
        {NOT_FOUND_HEADING}
      </Typography>
      <Muted>URL が違うか、ページが消えた可能性があります。アドレスを確かめるか、下のリンクから戻ってください。</Muted>
      {wikiKey ? (
        <RouterLink to="/w/$wikiKey" params={{ wikiKey }} sx={{ alignSelf: "flex-start" }}>
          すべてのページへ戻る
        </RouterLink>
      ) : (
        <RouterLink to="/">管理画面のトップへ戻る</RouterLink>
      )}
    </Stack>
  );

  if (wikiKey) return <PageBody>{content}</PageBody>;
  return (
    <Center>
      <Section sx={{ maxWidth: 420, textAlign: "center" }}>{content}</Section>
    </Center>
  );
}
