-- ツリーは常に公開サイトに出す（#55）。trees.is_public は使わなくなる。
-- 公開サイトから隠していたツリーが黙って公開に変わらないよう、そういう wiki があれば移行を止める。
-- 公開してよければ `update trees set is_public = true;` を実行してから、もう一度マイグレーションする。
DO $$
DECLARE
  hidden text;
BEGIN
  SELECT string_agg(w.key, ', ' ORDER BY w.key) INTO hidden
  FROM trees t JOIN wikis w ON w.id = t.wiki_id
  WHERE NOT t.is_public;
  IF hidden IS NOT NULL THEN
    RAISE EXCEPTION 'ツリーを公開サイトに出していない wiki があります: %。ツリーは常に公開になります。公開してよければ「update trees set is_public = true;」を実行してから、もう一度マイグレーションしてください', hidden;
  END IF;
END $$;
