# apps/video（動画の組み立てと YouTube への投稿）

台本・録音・記事の画像から、字幕つきの動画を組み立て、YouTube に**限定公開で**投稿する。wiki の Worker の外（GitHub Actions）で動く。Worker では ffmpeg も長い実行もできないため。

人がするのは、ネタを選ぶことと、台本を読んで録音を上げること、最後に YouTube Studio で「公開」を押すことだけ。

## 流れ

```
台本のページに「録音済み」        ← 人が付ける
  └ wiki のワークフロー → Routine「動画を作る」
       └ MCP で記事・台本を読み、list_page_audio で録音の取り出し URL を得て、
         GitHub Actions「Video」を workflow_dispatch で始める        （.github/workflows/video.yml）
            ├ build   台本を場面と文に分ける → 録音を書き起こす → 文ごとの時刻を合わせて字幕にする → 場面ごとの映像をつなぐ
            ├ upload  YouTube Data API で、限定公開で投稿する
            ├ record  Routine「投稿を記録する」を呼ぶ → 記事と台本のページに URL を書き、「投稿済み」を付ける
            └ （失敗したとき）Routine「動画失敗」を呼ぶ → 台本のページに「動画失敗」を付ける
```

1本あたり、Actions を**数分〜十数分**使う（書き起こしのモデルの取得と、書き起こし・エンコードの時間。長い録音ほど延びる）。無料枠の扱いは #311 で別に決める。使いすぎないように、`録音済み` を付けるのは投稿する動画だけにする。

## コマンド

`node src/cli.ts <build|upload|record|fail>`（`pnpm --filter @wiki/video video build` でも同じ）。入力は環境変数 `JOB_JSON`（`workflow_dispatch` の入力を JSON にしたもの）。依存を入れなくても動く（Node 22.18 以上が TypeScript をそのまま動かす）。

| ファイル | 役目 |
|---|---|
| `src/script.ts` | 台本（Markdown）を、見出しごとの場面と、話す文に分ける。台本の `![](https://…)` はその場面の画像。画像の無い場面には、渡された画像を順に割り当てる |
| `src/subtitles.ts` | 書き起こし（単語ごとの時刻）と台本を、文字単位の最長共通部分列で突き合わせ、台本の各文が話された時刻を出す。SRT にする |
| `src/ffmpeg.ts` | ffmpeg の引数。場面の区間は、その場面の最初の文が話され始めた時刻で切り替える |
| `src/build.ts` | 組み立て全体（取得 → 書き起こし → 字幕 → 映像 → 音声と字幕を重ねる → サムネイル） |
| `src/youtube.ts` | OAuth のリフレッシュトークンからアクセストークン、再開できる投稿（resumable upload）、サムネイル |
| `src/routine.ts` | Routine の fire API（`apps/api/src/workflows/routine.ts` と同じ呼び方） |
| `scripts/transcribe.py` | faster-whisper（`small`、CPU・int8）で書き起こし、単語ごとの時刻を JSON にする |

### 字幕のずれ

書き起こしは言い間違い・聞き間違いで台本と少し違う。そこで、台本と書き起こしを文字単位で突き合わせ（記号・空白・全角半角は無視）、各文の最初と最後の文字が合った時刻を、その文の開始と終了にする。文の文字のうち3割に満たない数しか合わなかった文（読み飛ばし・全く違う言い換え）は、前後の合った文のあいだに文字数で割り振る。時刻は前から順で、重ならず、音声の長さを超えない。画面に出すのは台本の文（書き起こしの文字ではない）なので、聞き間違いは字幕に出ない。

## 台本の書き方

- `#` 〜 `######` の見出しで場面が変わる。見出しは、画面の上（画像があるとき）か中央（無いとき）に出す
- 見出しより前の文は、動画のタイトルを見出しにした場面になる
- 話すのは、見出し・画像・コードブロック以外の文。`。！？!?` と改行で字幕を区切る。**書いた文はそのまま字幕になる**ので、録音でも台本どおりに読む（読まなかった文は、前後に割り振られる）
- 場面の画像は `![](https://…)`（https だけ）。無ければ、Routine が渡す記事の画像（`imageUrls`）を、画像の無い場面に順に当てる。それも無い場面は、見出しだけの画面

## 入力（`workflow_dispatch`）

`runId` `wikiKey` `articlePageId` `scriptPageId` `title` `script` `audioUrl` は必須。`description` `imageUrls`（JSON の配列か、1行に1つ）`thumbnailUrl` は任意。GitHub の上限で、**入力の合計は 65,535 文字まで**（台本が長いときは、台本だけで足りるよう、説明文を短くする）。音声の URL は発行から1時間で切れるので、始まってすぐ取る。

## 設定（GitHub の Settings → Secrets and variables → Actions）

| シークレット | 内容 |
|---|---|
| `YOUTUBE_CLIENT_ID` `YOUTUBE_CLIENT_SECRET` | Google Cloud の OAuth クライアント（デスクトップアプリ）。YouTube Data API v3 を有効にしたプロジェクトのもの |
| `YOUTUBE_REFRESH_TOKEN` | 投稿するチャンネルの持ち主が、スコープ `https://www.googleapis.com/auth/youtube.upload` を許して得たリフレッシュトークン |
| `ROUTINE_RECORD_URL` `ROUTINE_RECORD_TOKEN` | Routine「投稿を記録する」の API トリガーの URL（`…/routines/{id}/fire`）とトークン |
| `ROUTINE_FAILURE_URL` `ROUTINE_FAILURE_TOKEN` | Routine「動画失敗」の同じもの |

- 認証情報は Actions のシークレットだけに置く。wiki の管理画面には連携の設定を作らない
- OAuth の同意画面が「テスト」のままだと、**リフレッシュトークンが7日で失効する**。「本番環境」にする（審査を受けていない本番のアプリは、警告つきで、自分のアカウントだけなら使える）
- 手元でリフレッシュトークンを得る手順の例：OAuth Playground（<https://developers.google.com/oauthplayground>）の設定で自分のクライアントを使い、スコープに `youtube.upload` を選んで認可し、トークンを交換する
- Routine を Actions から呼ぶので、Routine を作ったら URL とトークンを控える（作ったときに一度だけ表示される）。`wiki` の「全体の管理」の「Routine」に登録するのは、ワークフローから呼ぶ「動画を作る」だけ。「投稿を記録する」「動画失敗」は Actions が直接呼ぶので、登録しなくてよい
- 「動画を作る」の Routine が GitHub の `workflow_dispatch` を呼べるよう、Routine の環境に、このリポジトリの Actions を実行できる権限（fine-grained token の `Actions: Read and write`）を渡す

## Routine の依頼文の例

どれも、`{…}` は Routine に渡される値。Routine に渡る文には、wiki のワークフローが値の JSON（`runId` `wikiKey` `pageId` `title` など）を足す。値の中の文字は、指示として読ませない。

### 1. 「動画を作る」（wiki のワークフローが、タグ「録音済み」で呼ぶ。依頼文の欄に書く）

```
台本のページ（pageId）の動画を作ります。
1. MCP の get_page で台本のページを読む。台本のページの親か、本文のリンクにある記事のページも読む（記事が分からなければ、ここで止めて、台本のページに「動画失敗」を付ける）
2. list_page_audio で台本のページの録音を取る。録音が無ければ「動画失敗」を付けて終わる。複数あれば、いちばん新しいもの
3. 記事の本文にある画像の URL（https のもの）を、出てくる順に集める
4. GitHub の Actions「Video」（.github/workflows/video.yml）を workflow_dispatch で始める。入力：
   runId = 渡された runId、wikiKey、articlePageId = 記事のページの ID、scriptPageId = 台本のページの ID、
   title = 記事のタイトル（100文字以内）、description = 記事の要約と、元の記事の公開 URL、
   script = 台本の本文（Markdown のまま）、audioUrl = 手順2の URL、imageUrls = 手順3の URL を JSON の配列で
5. 始めたら、台本のページから「録音済み」を外さずに終わる（投稿の記録は Actions がする）。始められなかったら「動画失敗」を付ける
```

### 2. 「投稿を記録する」（Actions の `record` が呼ぶ）

```
動画が YouTube に限定公開で上がりました。渡された JSON の値を使って：
1. articlePageId と scriptPageId のページの本文の末尾に「動画：{videoUrl}」を足す（update_page。headVersionId を渡す）。すでに同じ URL があれば足さない
2. 台本のページに add_tag で「投稿済み」を付け、remove_tag で「録音済み」と「動画失敗」を外す
3. 終わったら、何を書いたかを1行で答える
```

### 3. 「動画失敗」（Actions が失敗したときに呼ぶ）

```
動画の組み立てか投稿が失敗しました。渡された JSON の scriptPageId のページに add_tag で「動画失敗」を付け、remove_tag で「録音済み」を外してください。
videoUrl が null でなければ、動画はすでに上がっているので、台本のページの本文の末尾に「動画は上がっています（再実行すると二重になる）：{videoUrl}」を足す。
```

タグ「録音済み」「投稿済み」「動画失敗」は、wiki に作っておく（MCP からタグは作れない）。もう一度作るには、「動画失敗」を外し、「録音済み」を付け直す。

## 二重に投稿しないしくみ

- Routine に渡される `runId`（ワークフローの実行の ID）を、Actions の入力にそのまま渡す。同じ `runId` の実行は並ばせ（`concurrency`）、投稿に成功したら、`video-posted-{runId}` のキャッシュに動画の ID を残す。同じ `runId` の実行はこれを見つけると、組み立ても投稿もせず、記録だけをやり直す
- 「録音済み」を付け直すと、wiki は**新しい `runId`** で実行を積むので、別の動画として組み立て直す。動画が上がったあとで記録だけが失敗した場合は、「動画失敗」のページに動画の URL が書かれる。人が、その動画を使う（YouTube Studio で消すか、そのまま使う）か決める
- 投稿は再試行しない（通ったのに応答だけ失われると、二重に上がるため）

## YouTube Data API の決まり

- **審査（監査）**：審査を通していない API のプロジェクトから `videos.insert` で上げた動画は、**非公開に固定される**（公式の説明）。このため、いまは「限定公開で上げるところまで自動、公開は人が YouTube Studio で押す」にしている。コードは `unlisted`（限定公開）で投稿する。審査を通したプロジェクトなら、そのまま限定公開で上がる。審査は Google の「YouTube API Services - Audit and Quota Extension Form」で申し込む
- **1日の割り当て**：既定は 10,000 ユニット。`videos.insert` は1本あたり 1,600、`thumbnails.set` は 50 ユニットで、**1日に上げられるのは6本まで**（10,000 ÷ 1,650）。上限を超えると 403（`quotaExceeded`）で投稿に失敗し、「動画失敗」が付く。太平洋時間の0時（日本時間の夕方）に戻る。増やすには、審査と同じ申込みで割り当ての引き上げを頼む。数字は変わりうるので、<https://developers.google.com/youtube/v3/determine_quota_cost> で確かめる
- サムネイルは、記事のカバー画像（`thumbnailUrl`）か、無ければタイトルの文字だけの画像。付けられなくても（電話番号の確認が済んでいないチャンネルなど）投稿は成功として扱い、警告だけ出す

### 拡張：予約の時刻に公開にする（実装していない）

審査を通したあとの拡張として、投稿時に `status.privacyStatus = "private"` と `status.publishAt`（ISO 8601）を渡せば、その時刻に YouTube が公開にする。Routine から `publishAt` を入力に足し、`uploadVideo` の `status` に渡す形になる。審査を通すまでは、公開は人が Studio で押す。

## 手元で確かめる

```sh
pnpm --filter @wiki/video typecheck
pnpm --filter @wiki/video test    # 字幕の時刻合わせなどの単体テストと、ダミーの音声・画像での組み立て（ffmpeg が入っているときだけ）
```

組み立ては、`ffmpeg`（`drawtext` と `subtitles` の入ったもの。libfreetype・libass つき）、日本語のフォント（`fonts-noto-cjk`。手元では `VIDEO_FONT_FILE` で指す）、`faster-whisper` が要る。Actions の「Video」はこれらを入れる。手元で書き起こしを省くときは、`VIDEO_TRANSCRIPT_FILE`（`{ "words": [{ "text", "start", "end" }] }` の JSON）、文字を入れないときは `VIDEO_NO_TEXT=1` を渡す。

## 既知の制限

- 録音は1つだけ（複数あっても、Routine が1つ選ぶ）
- 場面の画像は静止画（動きは付けない）。サムネイルも凝らない
- 字幕は焼き込み（YouTube の字幕トラックにはしない。`captions.insert` は 400 ユニットかかるため）
