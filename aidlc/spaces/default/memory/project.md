# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> このファイルは itizawa/wiki 用に初期値を入れてある。リポジトリの決まりの元は
> ルートの `CLAUDE.md` で、ここはそれを AI-DLC のステージが読む形に写したもの。
> 食い違ったら `CLAUDE.md` を正とし、ここを直す。

## Way of Working

- 会話・質問・成果物（要件、設計、計画、レビューの記録）は日本語で書く。コード中の識別子は英語のまま
- 1つの intent は1つの PR にまとまる大きさにする。大きいものは Units Generation で分け、Unit ごとに PR にする
- 作業はブランチで行い、`main` へ直接 push しない。変更は PR にしてマージする
- UI（画面の見た目や操作）を変えたら、変更後の画面のスクリーンショットを PR の説明文に載せる。変更前と比べないと伝わらない変更は、変更前のものも並べる（管理画面には PR ごとのプレビューが無いため）。撮るときは `pnpm dev` で立ち上げ、開発用ログイン（`DEV_LOGIN_EMAIL`）で入る
- 使い方が変わったら、マニュアル（https://docs.hatchery-works.com/）も直す。`README.md` は概要と画面の紹介だけで、仕様は書かない

### Unit の分け方（Units Generation）

- 要件・ストーリー・ドメイン設計・契約は、フロントエンドとバックエンドで分けず、INCEPTION で1つにまとめて作る。領域ごとの資料は CONSTRUCTION の Unit ごとの設計（Functional Design など）で作り、INCEPTION の資料を領域別に書き写さない
- Unit は、パッケージ（デプロイ先）ごとに分ける。その intent が触るパッケージだけを Unit にする

  | Unit | パッケージ | kind | 依存する Unit |
  |---|---|---|---|
  | shared | `packages/shared` | `library` | なし |
  | api | `apps/api` | `service` | shared |
  | admin | `apps/admin` | `ui` | shared（api の新しい経路を使うなら api も） |
  | site | `apps/site` | `ui` | shared（公開用データ `/export/public` の形を変えるなら api も） |
  | worker | `apps/worker` | `service` | なし（呼び出す `/internal/*` の経路を変えるなら api） |

- **`packages/shared` が api・admin・site の契約になる**。リクエストとレスポンスの型、zod スキーマ、URL ルール、構造の適用・検証は shared に置き、api と admin（と site）は shared から読む。Contract Design で決めた API の約束は、shared の型とスキーマとして書く
- shared を変える intent では、shared の Unit を最初に作る（依存の無い Unit）。api・admin・site は shared に依存させ、shared ができたあとは互いに並行して作れるようにする
- Unit の名前は `u{n}-<上の Unit 名>`（例：`u1-shared`、`u2-api`、`u3-admin`）。PR は Unit ごとに分け、依存する Unit の PR がマージされてから次の PR をマージする
- shared だけで済む小さな変更（型を1つ足すなど）は、shared の Unit を作らず、それを使う Unit に含めてよい

## Walking Skeleton

- 置かない。デプロイの仕組み（`.github/workflows/deploy.yml`、Cloudflare Workers）はすでに動いているので、新しい機能はいまの構成に足していく

## Testing Posture

- 単体・結合テストは各パッケージの Vitest（`apps/video` だけ `node --test`）。API のテストは PGlite で動き、PostgreSQL は要らない
- 変更を入れる前と後に `pnpm typecheck` と `pnpm test` を通す。触ったパッケージだけなら `pnpm --filter <name> test`
- 管理画面の操作の流れを変えたら、`apps/e2e`（Playwright）のテストを足すか直す
- 公開サイト（`apps/site`）を変えたら `pnpm --filter @wiki/site build:sample` で限定公開の漏れなどの検査を通す
- テストを飛ばす・消す・無効にして通すことはしない

## Guard Policy

<!-- Project-specific. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

- `main` へのマージで `.github/workflows/deploy.yml` が CI を通してから Cloudflare（Workers・静的アセット）へデプロイする。AI-DLC の OPERATION フェーズでデプロイの仕組みを新しく作らない
- DB のスキーマを変えたら `pnpm db:generate` でマイグレーションを作り、同じ PR に入れる
- 本番の操作（DB、Cloudflare、外部サービスの設定）は、人がする。手順を PR の説明文か README に書く

## Code Style

- TypeScript。既存のコードの書き方・名前の付け方・コメントの量に合わせる
- 入力の検証と構造操作の型は `packages/shared` の zod スキーマに置き、API と管理画面で共有する
- 管理画面の一覧（表）は共通コンポーネント `apps/admin/src/components/DataList.tsx` で作る。MUI の `Table` をその場で組まない
  - 行に遷移先があるなら `rowLink` を渡し、行のどこを押しても移れるようにする。行の中には同じ遷移先の本物のリンク（`RouterLink`）も置く
  - 遷移先が無い一覧には `rowLink` を渡さない
  - 件数が増える一覧は、API を続きから取れるようにし（`limit` と `cursor`）、`virtualized` と `useInfiniteQuery` の `hasNextPage` `isFetchingNextPage` `fetchNextPage` を渡す
- 絞り込みと並べ替えは、表の上に共通コンポーネント `apps/admin/src/components/ListToolbar.tsx` を置いて作る。続きから取る一覧では、条件と並びを API に渡す（クライアントで並べ替えない）。並べ替えた列には `DataListColumn` の `sort` も渡す
- コメントと README は日本語で、平易な言葉で書く

## Tech Stack

- パッケージ管理：pnpm（`packageManager` のとおり）のワークスペース、Node 22（`.nvmrc`）
- `apps/admin`：React + MUI + TanStack Router / Query + dnd-kit、Vite
- `apps/api`：Hono + Drizzle + PostgreSQL（本番は Cloudflare Workers + Hyperdrive）
- `apps/worker`：Cloudflare Workers の Cron Triggers
- `apps/site`：Astro + React アイランド、Pagefind、Cloudflare Workers の静的アセット
- `apps/video`：GitHub Actions で動く動画の組み立て
- `apps/e2e`：Playwright
- `packages/shared`：型、zod スキーマ、URL ルール、構造の適用・検証・差分
- インフラは Cloudflare。AWS は使っていないので、AWS 向けのステージ・MCP サーバー（aws-*）は使わない

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
