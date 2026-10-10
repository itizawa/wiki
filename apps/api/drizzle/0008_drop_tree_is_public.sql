-- ツリーごと公開サイトから隠す設定（trees.is_public）を無くす。ツリーは常に公開サイトに出し、
-- 出す・出さないはページごとの公開範囲で決める。
-- いま隠しているツリーがあると、この移行で黙って公開サイトに出てしまうので、その場合は止める。
-- 止まったら、出してよいことを確かめたうえで
--   update trees set is_public = true where is_primary;
-- を実行し、もう一度マイグレーションを流す。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "trees" WHERE "is_primary" AND NOT "is_public") THEN
    RAISE EXCEPTION 'trees.is_public is false: the tree is hidden from the public site now, and this migration would show it. Confirm that it may be shown, run "update trees set is_public = true where is_primary;", then migrate again.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "trees" DROP COLUMN "is_public";
