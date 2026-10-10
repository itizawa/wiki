-- ルール・記事の状態・見直しキューを消す。落とすテーブルと列の中身は退避しない（元に戻せない）。
-- drizzle-kit が出した順（テーブルを CASCADE で落としてから外部キーを落とす）は、外部キーがもう無くて失敗するので、
-- 外部キー → 列 → テーブルの順に並べ直し、CASCADE を外している（想定していないものが指していたら、止まる）。

-- 予約の行は消さない。ルールが入れた予約も、ふつうの公開予約として残る
ALTER TABLE "scheduled_actions" DROP CONSTRAINT "scheduled_actions_rule_run_id_rule_runs_id_fk";--> statement-breakpoint
ALTER TABLE "scheduled_actions" DROP COLUMN "rule_run_id";--> statement-breakpoint
DROP TABLE "rule_runs";--> statement-breakpoint
DROP TABLE "rules";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_workflow_state_check";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_approved_version_check";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "workflow_state";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "approved_version_id";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "approved_at";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "review_requested_at";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "reviewed_at";
