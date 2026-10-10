/**
 * 絵文字の一覧。ページのアイコンを選ぶ画面と、本文で「:」を打つと出る候補に使う。
 * 絵文字のライブラリやデータは足さず（管理画面は PWA で JavaScript を先読みするので、軽くしておく）、
 * wiki のページで使いそうなものだけを自前で持つ。ここに無い絵文字は、入力欄に直接入れる（OS の絵文字パネルなど）。
 */

export type Emoji = {
  char: string;
  /** 英語の名前。「:memo」のように打って探す。一覧では絵文字の説明にもなる */
  name: string;
  /** 名前以外に、絞り込みで当たる語（日本語と、その読み） */
  keywords: string[];
};

export type EmojiGroup = { label: string; emojis: Emoji[] };

/** 1行に「絵文字 英語の名前 当たる語…」を空白で区切って書く。 */
const group = (label: string, lines: string): EmojiGroup => ({
  label,
  emojis: lines
    .trim()
    .split("\n")
    .map((line) => {
      const [char, name, ...keywords] = line.trim().split(/\s+/);
      return { char: char!, name: name!, keywords };
    }),
});

export const EMOJI_GROUPS: EmojiGroup[] = [
  group(
    "書きもの",
    `
    📝 memo メモ めも 書く かく ノート
    📄 page ページ 文書 ぶんしょ 書類 しょるい
    📚 books 本 ほん 資料 しりょう
    📖 book 本 ほん 読む よむ マニュアル
    📌 pin ピン 固定 こてい 重要 じゅうよう
    📎 clip クリップ 添付 てんぷ
    ✏️ pencil 鉛筆 えんぴつ 編集 へんしゅう
    🗒️ notepad メモ帳 めもちょう
    📋 clipboard クリップボード 一覧 いちらん
    🗂️ index 仕分け しわけ 整理 せいり
    📁 folder フォルダ ふぉるだ
    🏷️ label ラベル タグ たぐ
    🔖 bookmark しおり ブックマーク
    📰 news ニュース にゅーす 新聞 しんぶん
    💬 comment コメント 会話 かいわ 吹き出し ふきだし
    `,
  ),
  group(
    "仕事と予定",
    `
    📅 calendar カレンダー 予定 よてい 日付 ひづけ
    🗓️ schedule 予定 よてい 議事録 ぎじろく
    ⏰ alarm 時計 とけい 締め切り しめきり
    ⏳ hourglass 砂時計 すなどけい 待ち まち
    ✅ check チェック 完了 かんりょう 済み ずみ
    🎯 target 目標 もくひょう 的 まと
    📈 chart_up グラフ 上昇 じょうしょう 成長 せいちょう
    📉 chart_down グラフ 下降 かこう
    📊 bar_chart グラフ 集計 しゅうけい 分析 ぶんせき
    💼 briefcase 仕事 しごと かばん
    🤝 handshake 握手 あくしゅ 合意 ごうい
    📣 megaphone お知らせ おしらせ 告知 こくち
    📧 email メール めーる
    📞 phone 電話 でんわ
    🏢 office 会社 かいしゃ オフィス
    💰 money お金 おかね 費用 ひよう
    `,
  ),
  group(
    "知らせと目印",
    `
    💡 idea アイデア あいであ ひらめき 電球 でんきゅう
    ⭐ star 星 ほし スター お気に入り おきにいり
    🔥 fire 火 ひ 人気 にんき 急ぎ いそぎ
    ✨ sparkles きらきら 新しい あたらしい
    🚀 rocket ロケット ろけっと リリース 公開 こうかい
    🎉 tada お祝い おいわい クラッカー
    ⚠️ warning 注意 ちゅうい 警告 けいこく
    ❗ exclamation びっくり 重要 じゅうよう
    ❓ question はてな 質問 しつもん 疑問 ぎもん
    🚧 construction 工事中 こうじちゅう 作業中 さぎょうちゅう
    🔒 lock 鍵 かぎ 非公開 ひこうかい 秘密 ひみつ
    🔑 key 鍵 かぎ キー
    🔍 search 検索 けんさく 調べる しらべる 虫眼鏡 むしめがね
    👀 eyes 目 め 見る みる 確認 かくにん
    🧪 test 実験 じっけん 試験 しけん テスト
    🐛 bug バグ ばぐ 虫 むし 不具合 ふぐあい
    `,
  ),
  group(
    "開発と道具",
    `
    💻 laptop パソコン ぱそこん 開発 かいはつ
    🖥️ desktop 画面 がめん モニター
    📱 mobile スマホ すまほ 携帯 けいたい
    ⚙️ gear 設定 せってい 歯車 はぐるま
    🛠️ tools 道具 どうぐ 工具 こうぐ 開発 かいはつ
    🔧 wrench レンチ 修理 しゅうり 直す なおす
    🧩 puzzle パズル 部品 ぶひん 拡張 かくちょう
    🔗 link リンク りんく つなぐ
    🌐 globe 地球 ちきゅう ウェブ うぇぶ 公開 こうかい
    ☁️ cloud 雲 くも クラウド
    🗄️ cabinet データベース でーたべーす 保管 ほかん
    🤖 robot ロボット ろぼっと AI 自動 じどう
    📦 package 箱 はこ パッケージ 荷物 にもつ
    🧱 brick れんが 土台 どだい 基盤 きばん
    🧭 compass 方針 ほうしん 案内 あんない コンパス
    🗺️ map 地図 ちず 全体像 ぜんたいぞう
    `,
  ),
  group(
    "人と気持ち",
    `
    😀 smile 笑顔 えがお にこにこ
    😊 blush うれしい 笑顔 えがお
    😂 joy 笑い わらい 爆笑 ばくしょう
    🤔 thinking 考える かんがえる 検討 けんとう
    😢 cry 泣く なく 悲しい かなしい
    😡 angry 怒る おこる
    😴 sleep 眠い ねむい 休み やすみ
    🥳 party お祝い おいわい パーティー
    👍 thumbsup いいね よい 賛成 さんせい
    👎 thumbsdown よくない 反対 はんたい
    👏 clap 拍手 はくしゅ
    🙏 pray お願い おねがい ありがとう 感謝 かんしゃ
    👋 wave 手を振る こんにちは はじめに 挨拶 あいさつ
    💪 muscle 力 ちから がんばる
    ❤️ heart ハート はーと 好き すき
    👤 person 人 ひと ユーザー 担当 たんとう
    👥 people 人々 ひとびと チーム ちーむ メンバー
    `,
  ),
  group(
    "暮らしと自然",
    `
    ☀️ sun 太陽 たいよう 晴れ はれ
    🌙 moon 月 つき 夜 よる
    🌈 rainbow 虹 にじ
    🌱 seedling 芽 め 始まり はじまり 育てる そだてる
    🌳 tree 木 き ツリー
    🌸 sakura 桜 さくら 花 はな 春 はる
    🍀 clover クローバー 幸運 こううん
    🐱 cat 猫 ねこ
    🐶 dog 犬 いぬ
    🐣 chick ひよこ 孵化 ふか 新人 しんじん
    ☕ coffee コーヒー こーひー 休憩 きゅうけい
    🍵 tea お茶 おちゃ
    🍙 onigiri おにぎり ごはん 昼 ひる
    🍺 beer ビール びーる 飲み会 のみかい
    🎂 cake ケーキ けーき 誕生日 たんじょうび
    🏠 home 家 いえ ホーム ほーむ
    🏫 school 学校 がっこう 研修 けんしゅう
    ✈️ airplane 飛行機 ひこうき 出張 しゅっちょう 旅行 りょこう
    🚃 train 電車 でんしゃ 通勤 つうきん
    🎁 gift 贈り物 おくりもの プレゼント
    🎨 art デザイン でざいん 絵 え 色 いろ
    🎵 music 音楽 おんがく
    📷 camera カメラ かめら 写真 しゃしん
    🎮 game ゲーム げーむ
    ⚽ soccer サッカー さっかー 運動 うんどう
    🏆 trophy 優勝 ゆうしょう 表彰 ひょうしょう 実績 じっせき
    🎓 graduation 卒業 そつぎょう 学ぶ まなぶ 勉強 べんきょう
    `,
  ),
];

const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.emojis);

/**
 * 絞り込みの文字に当たる絵文字。名前か、当たる語の先頭が一致するものを、一覧の順で返す
 * （名前の先頭が一致したものを先に）。空なら何も返さない。
 */
export function searchEmoji(query: string, limit = 40): Emoji[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const byName = ALL_EMOJIS.filter((e) => e.name.startsWith(q));
  const byKeyword = ALL_EMOJIS.filter((e) => !e.name.startsWith(q) && e.keywords.some((k) => k.toLowerCase().startsWith(q)));
  return [...byName, ...byKeyword].slice(0, limit);
}
