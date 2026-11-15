# wiki

書いたそばから流れていく公開型 wiki。ページを書いて公開や予約をし、ワークフローや AI エージェントに作業の一部を任せられる。wiki を複数持て、それぞれ別のサブドメインで公開できる。

使い方は[マニュアル](https://docs.hatchery-works.com/)に、構成・デプロイ・ローカル開発の手順は [docs/operations.md](docs/operations.md) にある。

## どうやって作ったか

AI を使って、2週間程度で作った。設計から実装、テストまでを [Claude Code](https://claude.com/claude-code) と進めていて、コミットの大半に Claude が関わっている。

## 画面

### 書く

ページをツリーで階層に並べて書く。打つのを止めると自動で保存する。

![編集画面。左にページのツリー、右に本文](docs/images/readme/editor.png)

### 公開する

ページごとに、公開・限定公開・非公開を選べる。

![編集画面の「公開」メニュー](docs/images/readme/publish.png)

### 予約する

公開と非公開化を予約でき、予定は編集カレンダーで見渡せる。

![編集カレンダー。公開済みのページと予約が日付ごとに並ぶ](docs/images/readme/calendar.png)

### 変更をたどる

過去の版との差分を見て、その版に戻せる。

![版履歴。選んだ版との差分と版の一覧](docs/images/readme/history.png)

### ワークフローに任せる

タグが付いたときなどをきっかけに、Claude の Routine の呼び出しや、人の作業の依頼を順に進める。

![ワークフローの詳細。トリガーから順にアクションが並ぶ](docs/images/readme/workflow.png)

### 公開サイトを持つ

wiki ごとに公開サイトを持ち、検索や RSS も付く。

![公開サイトのトップ](docs/images/readme/site-home.png)

外観は管理画面で変えられる。

![公開サイトの外観の設定とプレビュー](docs/images/readme/appearance.png)

### 全体を見渡す

閲覧数、最近更新したページ、下書き、予約をダッシュボードで確かめられる。

![ダッシュボード](docs/images/readme/dashboard.png)
