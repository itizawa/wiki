# AI-DLC v2 の導入

このリポジトリ（itizawa/wiki）に AI-DLC v2 を入れたときの資料。プロダクトの概要、AI-DLC v2 の概要、このリポジトリに入れた内容、導入のときに出た疑問とその答えをまとめる。

- 入れた PR：https://github.com/itizawa/wiki/pull/503
- 入れた版：AI-DLC v2.11.2（2026年10月時点の最新の安定版）
- このプロジェクト向けの決まりは `aidlc/spaces/default/memory/project.md`

---

## 1. このプロダクト（wiki）の概要

書いたそばから流れていく公開型の wiki。wiki を複数持て、1つの wiki にツリーは1本。記事を公開まで運ぶワークフローを主役にする予定で、いまは書く・公開する・予約するところまでを実装している。

- **wiki = ページ・ツリー（1本）・予約・設定のまとまり**。wiki は複数作れ、それぞれ別のサブドメイン（`{key}.hatchery-works.com`）で公開する
- **ノードはすべてページ**。フォルダは無く、ページの下にページを置いて階層を作る
- めざす姿：ネタをページとして置けば、下書き起こし・置き場所の提案・公開前チェック・予約枠への投入までをワークフローが進め、人は「書く」と「確かめる」に集中する

### 構成

pnpm のワークスペース（Node 22）。インフラは Cloudflare（Workers・静的アセット）で、AWS は使っていない。

| パッケージ | 中身 |
|---|---|
| `apps/admin` | 管理画面（React + MUI + TanStack Router / Query + dnd-kit、Vite） |
| `apps/api` | API（Hono + Drizzle + PostgreSQL） |
| `apps/worker` | Cron Triggers（下書きを版にする、予約公開、公開ビルドの起動、間引きと掃除） |
| `apps/site` | 公開サイト（Astro + React アイランド、Pagefind） |
| `apps/video` | 台本・録音から動画を組み立て、YouTube に投稿する（GitHub Actions で動く） |
| `apps/e2e` | 管理画面の E2E テスト（Playwright） |
| `packages/shared` | 型、zod スキーマ、URL ルール、構造の適用・検証・差分。api・admin・site が使う |

---

## 2. AI-DLC v2 の概要

AI-DLC（AI-Driven Development Life Cycle）は、AWS が公開している「AI と一緒にソフトウェアを作る」ための手法と道具（[awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows)）。AI のコーディング支援を、決まった段階と人の承認を踏んで進む、記録の残る開発の流れに変える。v2 は2026年にプレビューを経て GA になり、いまも頻繁に版が上がっている。

### できること

- `/aidlc <頼みごと>` と書くと、作業の大きさに合った**流れ（scope）**を選び、計画を出す
- 開発を **5つのフェーズ・33の段階（stage）** に分け、流れに合わせて取捨して進める
- 段階の終わりごとに**承認ゲート**があり、人が承認・やり直し・飛ばしを決める
- 要件・設計・決めたこと・監査ログを `aidlc/` に残し、git でチームと共有する
- 14のエージェント（専門役11、レビュー役2、計画を組み立てる役1）
- 成果物の自動検査（sensors）、チームのルールと学んだことの蓄積（memory）
- Claude Code・Kiro・Codex CLI・Cursor・opencode・GitHub Copilot で同じ仕組みが動く

### フェーズと段階

| フェーズ | 段階 | 中身 |
|---|---|---|
| INITIALIZATION | 3 | 状態の用意、ディレクトリの用意、プロジェクトの検出 |
| IDEATION | 7 | 意図の確認、市場調査、実現性、範囲、チーム、ラフな画面、引き継ぎ |
| INCEPTION | 9 | 既存コードの把握、チームのやり方、要件、ユーザーストーリー、画面、ドメイン設計、Unit への分割、契約、計画 |
| CONSTRUCTION | 7 | 機能設計、非機能要件と設計、インフラ設計、実装、ビルドとテスト、CI（Unit ごとに回る） |
| OPERATION | 7 | デプロイの仕組み、環境、デプロイ、監視、障害対応、性能、改善 |

### 流れ（scope）

| scope | 使いどころ |
|---|---|
| `feature` | 新しい機能。要件から運用まで一通り |
| `bugfix` | 不具合の修正 |
| `refactor` | リファクタリング |
| `express` | 小さな変更。既存コードの把握・要件・実装・テストだけ |
| `classic` | 既定。INCEPTION 全部と、機能設計〜実装・テスト |
| ほか | `enterprise` `mvp` `poc` `infra` `security-patch` `workshop` |

`/aidlc --scope bugfix ...` のように指定もできる。指定しなければ、頼みごとの文から AI が提案し、人が確かめる。

---

## 3. このリポジトリに入れた内容

| 変えたところ | 中身 |
|---|---|
| `.claude/` | AI-DLC 本体（スキル、エージェント、段階の定義、フック、道具、`settings.json`）。公式インストーラで入れた `aidlc` コマンドの `aidlc config --harness claude --mcp none` で作った。フックと許可は `aidlc` を呼ぶ |
| `aidlc/` | ルールと、作業ごとの記録の置き場所 |
| `aidlc/spaces/default/memory/project.md` | このプロジェクトの決まり（下） |
| `.gitignore` | AI-DLC の作業ファイルと個人設定を外す |
| `.github/workflows/ci.yml`、`deploy.yml`、`scripts/ci-scope.sh` | `.claude/` と `aidlc/` だけの変更では CI もデプロイも動かさない |
| `README.md`、`CLAUDE.md` | 使い方と案内 |

`project.md` に書いた、このプロジェクトの決まり（元は `CLAUDE.md`）：

- 会話と成果物は日本語で書く
- UI を変えたら PR にスクリーンショットを載せる。使い方が変わったらマニュアルも直す
- テストは Vitest（API は PGlite）、管理画面の操作の流れは `apps/e2e`、公開サイトは `build:sample` の検査。テストを飛ばして通さない
- 管理画面の一覧は `DataList`、絞り込みと並べ替えは `ListToolbar`
- AWS は使わないので、AWS 向けの段階と MCP サーバーは使わない
- Unit の分け方（下の Q4・Q5）

使い始め方（`aidlc` コマンドは各自の手元に1回入れる。PATH に `~/.local/bin` が無ければ足す）：

```sh
tmp="$(mktemp -d)" && curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh -o "$tmp/install.sh" && sh "$tmp/install.sh"; rm -rf "$tmp"
claude                                    # 初回はフックの承認を求められる。承認したら Claude Code を開き直す
/aidlc --doctor                           # 入り方を確かめる
/aidlc 管理画面のタグ一覧に並べ替えを足す   # 頼みごとを書くと、流れを選んで計画を出す
```

---

## 4. 導入のときに出た疑問と答え

### Q1. Bun は必要か

**要らない。公式インストーラで入れた `aidlc` コマンドが、Bun を中に組み込んだ単体の実行ファイルだから。その代わり、使う人全員に `aidlc` が要る。**

- `.claude/settings.json` のフックは、ツールを呼ぶたびや会話の始めと終わりに `aidlc engine hook ...` を実行する。承認前に成果物を書き換えさせない、段階ごとのルールを渡す、記録を残す、といった AI-DLC のゲートと監査ログは、このフックの上で動いている
- 道具は TypeScript で書かれていて、Bun にしか無い API（`Bun.markdown` など）を使うので、Node では動かせない。Bun を別に入れて直接動かす「コピー方式」もあるが、公式は実行ファイルを使えるなら `aidlc config` を勧めているので、こちらにした
- `aidlc` が無いと、Claude Code のフックがエラーになり、AI-DLC のゲートと記録が動かない
- ターミナルから `claude` を開くなら、そのターミナルの PATH がフックに渡る。デスクトップアプリなどから開いてフックが動かないときは、`/etc/paths.d` のファイルに `~/.local/bin` を足して開き直す（`aidlc doctor` の案内）
- クラウドのセッションでも、環境のセットアップで `aidlc` を入れる。root で動く環境では、インストーラに `--allow-root` を付ける（クラウドのセッションではまだ試していない）

### Q2. そのことを示している公式ドキュメントはどこか

| 書いてあること | 場所 |
|---|---|
| 公式インストーラで入れれば Bun も Node.js も要らない（「The installed command and config path do not require Bun or Node.js.」） | [Install and Lifecycle](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/18-install-and-lifecycle.md) |
| Bun が要るのはコピー方式で、実行ファイルを使えるなら `aidlc config` を勧める（「When native executables are permitted, prefer `aidlc config`.」） | [Install and Lifecycle › Copy Channel](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/18-install-and-lifecycle.md#copy-channel) |
| フックと道具は `aidlc` で動く（「Framework commands run through `aidlc`」） | このリポジトリの `.claude/CLAUDE.md`（AI-DLC が入れるファイル） |

### Q3. CONSTRUCTION だけ cc-sdd を使うなど、一部だけ別の開発方式にできるか

**できる。ただし AI-DLC には段階を丸ごと差し替える仕組みが無いので、「AI-DLC の流れの中で cc-sdd を呼ぶ」か「その間だけ AI-DLC の外で使う」形になる。**

AI-DLC の決まり：

- **プラグイン**で、新しい段階を足したり、既存の段階の手順に文章を差し込んだりできる
- **既存の段階を消す・上書きすることはできない**（「Additive only. Contributions add — they cannot override or remove a core stage's fields, agent, or prose.」[Authoring a Plugin › Rules of the road](https://github.com/awslabs/aidlc-workflows/blob/main/docs/harness-engineering/10-authoring-a-plugin.md#rules-of-the-road)）
- 作業ごとに段階を飛ばすことはできる（承認ゲートでの skip、`/aidlc --stage <slug>`、`/aidlc compose`）
- 段階の中身そのものを書き換えるには、AI-DLC のソースを直してビルドし直す（フォークの扱い）

やり方は3つ：

| やり方 | 中身 | 向き不向き |
|---|---|---|
| ① 運用で切り替える | INCEPTION まで AI-DLC で進め、Code Generation で cc-sdd の `/kiro-impl` に AI-DLC の要件と設計を渡し、Build & Test から AI-DLC に戻る | 設定変更なしで試せる。監査ログとセンサーは cc-sdd が書いたものをたどれない。AI-DLC のフックが流れの途中で止める場合があるかは未確認 |
| ② プラグインで指示を足す | `code-generation` 段階に「実装は cc-sdd の `/kiro-impl` で進める」手順を差し込む | 承認ゲートと記録が残る。元の手順も残るので、ぶつからない書き方が要る |
| ③ フォークして書き換える | `code-generation` 段階を直接書き換える | 版を上げるたびにすり合わせが要る。おすすめしない |

**気をつけること：工程が重なる。** cc-sdd も要件（EARS 形式）→ 設計 → タスク → 実装を一通り持っている。cc-sdd 用に要件と設計を作り直すと、`aidlc/` と `.kiro/` の二重管理になる。cc-sdd の強みは、タスクごとに新しい実装役とレビュー役のサブエージェントを立てて進める `/kiro-impl` なので、使うならそこだけを借りるのがよい。

**結論**：二重管理になるため、いまは cc-sdd を組み合わせず、AI-DLC だけで進める。

### Q4. フロントエンドとバックエンドを一緒に進めて、実装の段階で分かれることはできるか。成果物はフルスタックで作られるので、どこかで領域別の資料に分け直す必要があるのでは

**できる。AI-DLC はもともとその形で進む。分かれ目は INCEPTION の Units Generation で、領域ごとの資料は CONSTRUCTION で Unit ごとに作られるので、フルスタックの資料をあとから分け直す必要はない。**

```
INCEPTION（全体で1つ）
  要件 → ユーザーストーリー → ドメイン設計
  → Units Generation    ← ここで分ける（例：shared / api / admin）
  → Contract Design     ← 分けた Unit どうしの API の約束を決める
  → Delivery Planning   ← 順番と並行のさせ方を決める
CONSTRUCTION（Unit ごとに回る）
  Functional Design → NFR → Code Generation → Build & Test
  （成果物は construction/<unit名>/ に Unit ごとに出る）
```

- **Units Generation**：最初に「何で分けるか」（サービス・機能・ドメイン・デプロイ先）を聞かれる。各 Unit に種類（`kind`）を付ける（`ui` = 画面、`service` = 動くサーバー、`spec` / `library` = 契約や共有コード）。この種類によって CONSTRUCTION で作られる設計書が変わり、たとえば `ui` の Unit では `frontend-components.md`（画面の部品構成）が作られる。Unit 間の依存も書き出し、依存の無い Unit どうしは並行して作れる
- **Contract Design**：Unit が2つ以上あってつながるときに動き、API の約束（`contract-summary`）を決める。フロントエンドとバックエンドが別々に進んでも食い違わないための資料
- **CONSTRUCTION**：Functional Design（`entities.md`、`rules.md`、`functional-spec.md`、`ui` なら `frontend-components.md`）から実装・テストまでを Unit ごとに回す。既定は1つの Unit を最後まで作ってから次へ（直列）。並行して作る設定（swarm）もあるが、まだ試していない

**二重管理にならない理由**：全体の資料（要件・ストーリー・ドメイン設計・契約）は INCEPTION に1つだけ置き、領域別に書き写さない。領域ごとの資料は、Unit ごとの CONSTRUCTION で初めて作られる。各 Unit が担当する要件は `unit-of-work-story-map.md`（どのストーリーをどの Unit が実装するかの表）でたどれ、センサーが抜けを検査する。

### Q5. `packages/shared` を用意して、api と admin（と site）がそれに依存するようにしたい

**`packages/shared` はすでにあり、`apps/api`・`apps/admin`・`apps/site` の3つとも依存している**（`"@wiki/shared": "workspace:*"`）。コードの構成は変えず、AI-DLC が Units Generation でこの形に分けるよう、`aidlc/spaces/default/memory/project.md` の「Unit の分け方」に決まりとして書いた。

| Unit | パッケージ | 種類 | 依存する Unit |
|---|---|---|---|
| shared | `packages/shared` | `library` | なし |
| api | `apps/api` | `service` | shared |
| admin | `apps/admin` | `ui` | shared（api に新しい経路を足すなら api も） |
| site | `apps/site` | `ui` | shared（公開用データ `/export/public` の形を変えるなら api も） |
| worker | `apps/worker` | `service` | なし（呼び出す `/internal/*` の経路を変えるなら api） |

- 要件・ストーリー・ドメイン設計・契約は INCEPTION で1つにまとめ、領域別に書き写さない
- Unit はパッケージごとに分け、その作業が触るパッケージだけを Unit にする
- **`packages/shared` を api・admin・site の契約にする**。Contract Design で決めた API の約束は、shared の型と zod スキーマとして書く
- shared を変える作業では shared の Unit を最初に作り、そのあと api・admin・site を並行して作れるようにする
- Unit の名前は `u{n}-<Unit 名>`（例：`u1-shared`、`u2-api`、`u3-admin`）。PR は Unit ごとに分け、依存する Unit の PR がマージされてから次をマージする
- 型を1つ足す程度の小さな変更なら、shared の Unit を作らず、それを使う Unit に含めてよい

worker は shared を使っていないので、shared ではなく「api の `/internal/*` を呼ぶ側」として依存を書いた。

---

## 参考

- [awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows)（README、[Getting Started](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/01-getting-started.md)、[Customization](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/13-customization.md)、[Install and Lifecycle](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/18-install-and-lifecycle.md)、[Harness Engineer Guide](https://github.com/awslabs/aidlc-workflows/blob/main/docs/harness-engineering/00-overview.md)、[Authoring a Plugin](https://github.com/awslabs/aidlc-workflows/blob/main/docs/harness-engineering/10-authoring-a-plugin.md)）
- [AWS AI-DLC blog post](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/)
- [GAになった AI-DLC Workflows v2.5.5 を Kiro CLI で動かしてみた（Classmethod）](https://dev.classmethod.jp/articles/aidlc-workflows-v2-ga-kiro-cli/)
- [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd)
