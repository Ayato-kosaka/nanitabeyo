# Instagram 公開 embed URL の実機検証（Phase 0 / B3）

検証日: 2026-08-27
実行環境: EC2 上の Chrome（Instagram にログイン済みセッション）

## 検証の目的

Instagram oEmbed **API**（`graph.facebook.com/instagram_oembed`）は App Review とビジネス認証が必須、
というのが一次資料で確定した結論。一方、投稿ページには `https://www.instagram.com/p/<shortcode>/embed/`
という公開の埋め込み用 URL が存在する。**この2経路が別物なのか**を実機で確かめた。

## 結論（先に）

**別物である。** `/embed/` URL は App Review・アクセストークン・ビジネス認証のいずれも不要で、
第三者ドメインの iframe から直接読み込んで完全に描画される。
oEmbed API が要求する審査は「oEmbed の JSON/HTML を API 経由で取得する」ための要件であって、
`/embed/` を iframe の `src` に入れる経路には掛かっていない。

## 1. 対象投稿

- アカウント: `kajicurry`
- permalink: `https://www.instagram.com/p/DPXWZtED2sG/`
- 内容: カレー写真のカルーセル投稿、キャプション「器マラソン#21」、114 likes、2025年10月3日

## 2. 公開 embed URL の直接表示

テストした URL:

    https://www.instagram.com/p/DPXWZtED2sG/embed/

観察結果:

| 項目 | 結果 |
|---|---|
| 投稿画像 | 描画された（カルーセル、ドットインジケータ付き） |
| アカウント名 | 描画された（`kajicurry` / `Kajicurry` + プロフィール画像） |
| キャプション | **描画されなかった**（本文テキストは embed 内に出ない） |
| ログイン要求 | **なし**。ログイン画面・ログインウォールは一切出ない |
| 帰属表示 | あり（後述） |

embed ページの全テキスト（`document.body.innerText`）:

> kajicurry Kajicurry View profile kajicurry 54 posts · 4K followers View more on Instagram Like Comment Share Save 111 likes Add a comment... Instagram

つまり embed が持っているのは **画像 + アカウント名 + フォロワー数 + いいね数 + Instagram への導線** であって、
キャプション本文は含まれない。キャプションを見せたい場合は自前で持つ必要がある。

証跡: `/home/ubuntu/evidence_b3/01_公開embedの表示.png`

### 帰属表示（attribution）

embed 内に以下がハードコードされて出る:

- ヘッダー左: プロフィール画像 + `kajicurry` + 表示名 `Kajicurry`（アカウントのプロフィールへのリンク）
- ヘッダー右: **View profile** ボタン（青）
- 中央下: **View more on Instagram** リンク
- フッター: Like / Comment / Share / Save アイコン、`111 likes`、`Add a comment...`、`Instagram` ロゴ

DOM のクラス名も `Embed` / `Header` / `AvatarContainer` / `Username` / `ViewProfileButton` /
`EmbeddedMedia` / `EmbedFrameWithSidecar` と、埋め込み専用にサーバサイドで組まれている。
帰属表示は消せない前提で設計されている（＝規約上の帰属要件が UI に組み込まれている）。

## 3. ページの自己完結性（外部 JS 依存）

`/embed/` ページを JS で調べた結果:

- HTML 長: 約 436,000 文字（サーバサイドレンダリング済み、コンテンツは HTML に入っている）
- `<script>` 総数: 57
- 外部 `<script src>` のホスト: **`static.cdninstagram.com` のみ**（他ドメインは 0）
- **`embed.js` は読み込まれていない**（src 名に `embed` を含むスクリプトは 0 件）
- CSS も `static.cdninstagram.com` の 5 ファイルのみ

→ **このページは自己完結している。** ホスト側に `//www.instagram.com/embed.js` を貼る必要はない。
`embed.js` が要るのは `<blockquote class="instagram-media">` 方式（blockquote を iframe に変換するスクリプト）
の場合であって、`/embed/` を iframe の `src` に直接入れる方式では不要。

## 4. 第三者オリジンからの iframe 読み込み（追加検証）

「Instagram 自身のタブで開けた」だけでは iframe 可否の証明にならないので、
**`https://example.com` を開き、そこに JS で iframe を注入して**検証した。

    <iframe src="https://www.instagram.com/p/DPXWZtED2sG/embed/" width="420" height="600">

結果:

- 親オリジン: `https://example.com`
- `load` イベント発火、`X-Frame-Options` / `frame-ancestors` によるブロックなし
- iframe 内に投稿画像・カルーセルの次へボタン・ドットインジケータ・
  「more on Instagram」リンク・Like / Comment / Share / Save アイコンが**完全に描画された**

→ **トークン無し・審査無しで、任意のドメインから iframe に入れて動く。**

## 5. 失効時（投稿が消えたとき）の UX

存在しない shortcode を指定:

    https://www.instagram.com/p/CzzzzzzzzzZ/embed/

結果は **空白でもエラーページでもなく、Instagram ブランドのプレースホルダ**が返る。

表示された文言（原文ママ）:

> The link to this photo or video may be broken, or the post may have been removed.

画面構成:

- Instagram のカラーロゴアイコン
- Instagram のロゴタイプ（筆記体）
- 上記の文言（中央、グレーの小さい文字）
- **Visit Instagram** リンク（青）

HTTP レベルでも壊れず、iframe の中に上のカードが収まる形で表示される。

→ Phase 5 の失効時 UX として: **こちらが何もしなくても破綻しない。**
枠が真っ白になったり赤いエラーが出たりはせず、Instagram 側が用意した穏当なカードに置き換わる。
ただし「投稿が消えた」ことをこちらのアプリ側で検知したい場合、iframe の中身は
クロスオリジンで読めないので、この文言をこちら側から判定することはできない。
検知が必要なら別経路（permalink への HEAD/GET など）が要る。

証跡: `/home/ubuntu/evidence_b3/02_存在しない投稿のembed.png`

## 6. アカウント側が埋め込みを許可しているか

`kajicurry` の投稿 `DPXWZtED2sG` の「…」メニューを開いて確認（開いただけ、操作なし）。

メニュー項目:

> Report | About this account | Share to... | Copy link | **Embed**

→ **Embed 項目あり。** このアカウントは埋め込みを許可している。
（Instagram はアカウント設定で埋め込みを無効化でき、無効の場合この項目が消え、
`/embed/` も表示されなくなる。つまり「Embed 項目の有無」が事前チェックとして使える。）

## 7. Phase 0 としての含意

1. **oEmbed API と `/embed/` iframe は別経路。** 前者は App Review + ビジネス認証が必須だが、
   後者は無審査・無トークンで今すぐ使える。API のブロッカーは iframe 経路には効かない。
2. **その代わり、iframe 経路では投稿のメタデータが取れない。** キャプション本文すら embed に出ない。
   画像 URL・キャプション・投稿日時をこちら側の DB に持ちたいなら、それは iframe では解決しない
   （そこが oEmbed API / Graph API の役目であり、審査が必要な部分）。
3. **見せるだけなら iframe で足りる。** 帰属表示は Instagram 側が UI に埋め込むので、
   規約上の表示要件を自前で実装する必要がない。
4. **失効時は自動的に穏当なプレースホルダに退避する。** 監視は不要。
   ただし失効の検知はできないので、「消えた投稿を一覧から自動で外す」機能が要るなら別途設計が必要。
5. **アカウント単位で埋め込み無効化されうる。** 導入前に対象アカウントの「…」→ Embed の有無を確認するとよい。

## 検証で使ったもの

- Chrome（EC2、ログイン済み Instagram セッション）
- 状態変更操作なし（投稿・いいね・フォロー・DM・コピー・共有いずれも行っていない）
- 認証情報の入力なし
