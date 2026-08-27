# Instagram 投稿の自社アプリ内埋め込み — 本番利用条件（一次資料）

- 調査日: 2026-08-27
- 調査者: Claude (EC2 無人実行 / Chrome 経由で公開ドキュメントを閲覧のみ)
- 認証情報の入力・設定変更・フォーム送信は一切行っていない

## 参照した一次資料

| # | URL | 状態 | 最終更新（原文表記） |
|---|-----|------|--------------------|
| 1 | https://developers.facebook.com/docs/instagram-platform/oembed （→ /documentation/instagram-platform/oembed にリダイレクト） | 取得成功 | Updated: May 15, 2026 |
| 1b | https://developers.facebook.com/docs/graph-api/reference/instagram-oembed （API リファレンス） | 取得成功 | v26.0 |
| 1c | https://developers.facebook.com/docs/features-reference/oembed-read （旧 feature） | 取得成功 | — |
| 1d | https://developers.facebook.com/docs/features-reference/meta-oembed-read （現行 feature） | 取得成功 | — |
| 2 | https://developers.facebook.com/terms/ （Meta Platform Terms） | 取得成功 | Last updated February 3, 2026 |
| 3 | https://developers.facebook.com/devpolicy/ （Developer Policies） | 取得成功 | Last updated February 3, 2026 |

補足: 1c/1d は手順に無いが、資料1の "Requirements" セクションに実体が無かったため、
A（トークン・access level・App Review）の一次根拠を確定させる目的で追加参照した。

---

## A. oEmbed の利用条件（App Access Token / access level / App Review）

### A-1. oEmbed 本体ドキュメントの "Requirements" は実質空だった（重要）

資料1 の `## Requirements` セクションは、HTML レンダリング版・Markdown 版
（https://developers.facebook.com/documentation/instagram-platform/oembed.md）の
双方を確認したが、中身は以下2項目のみで、**アクセストークン・access level・App Review に関する記述は無い**。

> ## Requirements
>
> #### Base URL
>
> All endpoints can be accessed via the `graph.facebook.com` host.
>
> #### Endpoints
>
> - [`GET /instagram_oembed`](https://developers.facebook.com/docs/graph-api/reference/instagram-oembed)

日本語: oEmbed 解説ページの「要件」欄にはベース URL とエンドポイントしか書かれておらず、トークン要否はこのページ単体では判断できない。

### A-2. トークン必要性は API リファレンスのエラーコードとサンプルから確定

資料1b（Graph API Reference: Instagram Oembed）の PHP SDK サンプル:

> ```
> $response = $fb->get(
>   '/instagram_oembed',
>   '{access-token}'
> );
> ```

同ページの Error Codes:

> | Error | Description |
> | 200 | Permissions error |
> | 100 | Invalid parameter |
> | 190 | Invalid OAuth 2.0 Access Token |
> | 368 | The action attempted has been deemed abusive or is otherwise disallowed |

日本語: サンプルが access-token を必須引数として渡しており、エラー 190（Invalid OAuth 2.0 Access Token）/ 200（Permissions error）が定義されているので、アクセストークン（App Access Token または Client Token）が必要であることは確実。

### A-3. feature 名は「Meta oEmbed Read」（旧「oEmbed Read」は 2025-11-03 廃止）

資料1c（oEmbed Read）冒頭:

> On April 8, 2025, we introduced a new oEmbed feature, Meta oEmbed Read to replace the existing oEmbed Read feature. The current oEmbed Read feature will be deprecated on November 3, 2025.
>
> Apps created after April 8, 2025 that implement oEmbed will use the new Meta oEmbed Read feature.
> Existing apps that already use the current oEmbed Read feature will be automatically updated to the new Meta oEmbed Read feature by November 3, 2025.

> The following fields are no longer returned and will be fully deprecated on November 3, 2025:
> `author_name` / `author_url` / `thumbnail_height` / `thumbnail_url` / `thumbnail_width`

日本語: 現在の feature 名は **Meta oEmbed Read**。旧 oEmbed Read は 2025-11-03 で廃止済み。あわせて author_name / author_url / thumbnail_url 等のフィールドは返らなくなっている（＝サムネイル URL を自前レンダリングに使う設計は不可）。

資料1d（Meta oEmbed Read）本文:

> **Requires App Review.**
>
> The oEmbed Read feature allows your app to get embed HTML and basic metadata for public Facebook and Instagram pages, posts, and videos. The allowed usage for this feature is to provide front-end views of Facebook and Instagram pages, posts, and videos. You may also use this permission to request analytics insights to improve your app and for marketing or advertising purposes, through the use of aggregated and de-identified or anonymized information (provided such data cannot be re-identified).
>
> **Allowed Usage**
> To provide front-end views of public Facebook and Instagram pages, posts, and videos
>
> **Additional Details**
> This permission or feature requires successful completion of the App Review process before your app can access live data. Learn More.
> This permission or feature is only available with business verification. You may also need to sign additional contracts before your app can access data. Learn More Here

日本語: 本番（live data）で使うには **App Review 通過が必須**、かつ **ビジネス認証（business verification）が必須**、場合によっては追加契約の署名も必要。

### A-4. access level（Standard / Advanced）

資料1〜3および 1c/1d のいずれにも、**"Standard Access" / "Advanced Access" という語で
Meta oEmbed Read の access level を明示した記述は見つからなかった**。
ただし 1d が「App Review 通過必須」「business verification 必須」「live data へのアクセス」と述べており、
これは Meta の access level 体系における Advanced Access の条件そのもの（Standard Access は
App Review 不要だが自分の App のロール保有者のデータにしかアクセスできない）。
→ **実務上は Advanced Access 相当と扱うべきだが、"Advanced" という文言での明記は今回の3資料には無い**。

### A-5. レート制限

> Rate limits
> You can make up to 1,000 requests every hour.

日本語: 1時間あたり 1,000 リクエストまで。

---

## B. 削除・非公開になった投稿を埋め込んだときの挙動

資料1 Limitations:

> * Posts on private, inactive, and age-restricted Instagram accounts are not supported.
> * Accounts that have [disabled **Embeds**](https://help.instagram.com/252460186989212/) are not supported.
> * Stories are not supported.
> * Shadow DOM is not supported.

資料1b Error Codes:

> | 100 | Invalid parameter |

日本語: 非公開（private）・休眠（inactive）・年齢制限アカウントの投稿、および Embeds を無効にしたアカウントは非対応。埋め込み後に投稿が削除された場合の具体的な表示挙動（プレースホルダが出るのか空になるのか等）を明示した記述は、今回の3資料には無い。取得時点で非対応の URL を投げた場合はエラー 100（Invalid parameter）が返る形になる。

**判定: 「削除後の挙動」そのものは記載なし。ただし非公開化・Embeds 無効化された投稿は API から取得できなくなるため、埋め込みは実質失敗する。**

実装上の含意:
- 埋め込み HTML は `embed.js` が実行時にレンダリングする（下記 C 参照）ため、投稿が削除されれば Instagram 側のレンダリングが空/エラーになる。
- 資料1の「front-end view のみ」制限（下記 E）と 3.d の削除義務（下記 D）から、**削除済み投稿のキャプション等を自社 DB に残して表示し続ける設計は不可**。

---

## C. attribution（帰属表示）の要件

資料1 Embed JS:

> The embed HTML contains a reference to the Instagram [embed.js](https://www.instagram.com/embed.js) JavaScript library. When the library loads, it scans the page for the post HTML and generates the fully rendered post. If you want to load the library separately, include the `omitscript=true` query string parameter in your request. To manually initialize the embed HTML, call the `instgrm.Embeds.process()` function after loading the library.

資料1 サンプルレスポンス:

> ```
> {
>   "version": "1.0",
>   "provider_name": "Instagram",
>   "provider_url": "https://www.instagram.com/",
>   "type": "rich",
>   "width": 658,
>   "html": "<blockquote class=\"instagram-media\" data-instgrm-ca...",
> }
> ```

資料3（Developer Policies）2. Encourage proper use:

> Respect the way Meta Products look and function, and the limits we've placed on product functionality.

日本語: 「attribution を必ず表示せよ」と明文で書いた条項は、今回の3資料には無い。ただし帰属表示は API が返す `html`（`<blockquote class="instagram-media">` ＋ `embed.js`）の中に Instagram 側が組み込んでおり、Developer Policies の「Meta 製品の見た目と機能を尊重せよ／課された制限を尊重せよ」により **返された embed HTML を改変して帰属表示や Instagram ロゴを削る行為は不可**と読むべき。

関連（資料3 12. Social Plugins。oEmbed 埋め込みそのものではないが同種の考え方）:

> Don't obscure or cover elements of social plugins.

日本語: ソーシャルプラグインの要素を隠したり覆ったりしてはならない。

**判定: 「attribution 必須」の直接条項は記載なし。ただし embed HTML をそのまま出す限り帰属表示は自動的に含まれ、それを削除・隠蔽することは禁止側に倒れる。**

---

## D. データの保持・キャッシュ・削除（Meta Platform Terms）

### D-0. 前提: 「Process」の定義（Platform Terms 12.m Glossary）

> m. "Process" means any operation or set of operations performed on data or sets of data, whether or not by automated means, including use, collection, storage, sharing, or transmission.

日本語: 「Process（処理）」には **保存（storage）** が含まれる。したがって「取得したデータを DB に保存すること」は Processing にあたり、Processing に関する全条項が適用される。

### D-1. 【最重要】oEmbed 固有の永続化禁止（資料1 Limitations）

> * The Instagram oEmbed endpoint is **only** meant to be used for embedding Instagram content in websites and apps. It is not to be used for any other purpose. **Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other than providing a front-end view of the page, post, or video is strictly prohibited**. This prohibition encompasses consuming, manipulating, extracting, or **persisting** the metadata and content, including but not limited to deriving information about pages, posts, and videos from the metadata for analytics purposes.

日本語: oEmbed から得たメタデータ・投稿内容（およびその派生物）を、フロントエンド表示以外の目的に使うことは **厳格に禁止**。この禁止には「消費する・加工する・抽出する・**永続化する**」が含まれ、分析目的でメタデータから情報を導出することも含む。

→ **caption 等を自社 DB に保存すること自体が、oEmbed 経由のデータについては原則アウト。**
   保存が許されるのは「フロントエンド表示を提供するため」に必要な範囲に限られ、
   期間指定のキャッシュ許容（「◯日まで」等）は資料1〜3のどこにも書かれていない。

### D-2. Platform Terms 3.d — Retention, Deletion, and Accessibility of Platform Data

> **d. Retention, Deletion, and Accessibility of Platform Data**
>
> i. Unless required to keep Platform Data under applicable law or regulation, you must (and must make reasonable efforts to ensure your Service Providers) do the following:
>
> 1. Update or delete Platform Data promptly after receiving a request from us or the User to do so and give Users an easily accessible and clearly marked way to ask for their Platform Data to be modified or deleted.
>
> 2. Delete all Platform Data as soon as reasonably possible in the following cases:
>
>    a. When retaining the Platform Data is no longer necessary for a legitimate business purpose that is consistent with these Terms and all other applicable terms and policies;
>
>    b. When you stop operating the product or service through which the Platform Data was acquired;
>
>    c. When we request you delete the Platform Data for the protection of Users (which we will determine at our sole discretion);
>
>    d. When a User requests their Platform Data be deleted or no longer has an account with you (unless the Platform Data has been aggregated, obscured, or de-identified so that it cannot be associated with a particular User, browser, or device), or for Tech Providers, when a User or the Client requests their Platform Data be deleted or the Client no longer has an account with you;
>
>    e. When required by applicable law or regulations; or
>
>    f. As required under Section 7 ("Compliance Review Rights and Suspension and Termination of these Terms").
>
> ii. If you are required to keep Platform Data under applicable law or regulation, you must retain proof of the applicable legal or regulatory requirement or request and provide it if we ask for it.
>
> iii. If you have received Platform Data in error, you must immediately report this to us using this form, [...]

日本語: 3.d.i.1 — Meta またはユーザーから要求があれば **速やかに更新・削除**し、ユーザーが変更・削除を依頼できる導線をアプリ内にわかりやすく用意する義務がある。3.d.i.2 — 正当な業務目的が消えたとき / サービス提供をやめたとき / Meta が要求したとき / ユーザーが削除を求めたか退会したとき等は、**合理的に可能な限り速やかに全 Platform Data を削除**しなければならない。

### D-3. 「キャッシュは◯日まで」という記述は存在しない（明記）

Meta Platform Terms（全文 44,621 文字）を全文検索した結果、
**"cache" / "caching" の語は 1 件も出現しない**。
Developer Policies（全文 24,112 文字）にも **"cache" は 0 件**。

日本語: 「キャッシュは24時間まで」「30日以内に再取得」といった**具体的な期間を定めた条項は、Platform Terms にも Developer Policies にも存在しない**。判断基準は期間ではなく「3.d の目的限定＋削除義務」と「資料1 の永続化禁止」。

### D-4. 3.a.viii — 許可された目的以外の Processing 禁止

> viii. Processing Platform Data for purposes other than the applicable permitted purposes set forth in Meta's Developer Docs.

日本語: Meta の Developer Docs に定められた許可目的以外の目的で Platform Data を Processing することは Prohibited Practices。→ oEmbed の許可目的は「front-end view の提供」のみ（資料1・1d）なので、この条項が資料1の制限を Platform Terms 違反に直結させる。

---

## E. 取得データを機械学習・AI モデルの学習／推論に使うことの制限

### E-1. 直接的な「AI/ML 禁止条項」は存在しない（明記）

Meta Platform Terms 全文（44,621 文字）および Developer Policies 全文（24,112 文字）を
以下のキーワードで全文検索した結果、**いずれも 0 件**だった:

- `machine learning` — 0 件（両文書）
- `artificial intelligence` — 0 件（両文書）
- `train` / `Train`（training, train a model 等）— 0 件（両文書）
- `model` — 0 件（Developer Policies）

**→ 「取得したデータを機械学習・AI モデルの学習や推論に使うこと」を名指しで制限する条項は、
   Meta Platform Terms にも Developer Policies にも見つからなかった。**

### E-2. ただし実質的には包括条項で禁止側に倒れる（3 本の条項が効く）

**(1) 資料1 Limitations（oEmbed 固有・最も強い）**

> **Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other than providing a front-end view of the page, post, or video is strictly prohibited**. This prohibition encompasses consuming, manipulating, extracting, or persisting the metadata and content, including but not limited to deriving information about pages, posts, and videos from the metadata for analytics purposes.

日本語: 「front-end view の提供以外の目的」は厳格に禁止。**AI 学習も推論も front-end view ではない**ので、この一文で oEmbed 由来データの ML 利用は明確にアウト。「derivations（派生物）」を含むと明記されているので、caption を埋め込みベクトル化したもの・要約したものも同じ扱い。

**(2) Platform Terms 3.a.viii（Prohibited Practices）**

> viii. Processing Platform Data for purposes other than the applicable permitted purposes set forth in Meta's Developer Docs.

日本語: Developer Docs の許可目的以外の Processing は禁止行為。Glossary 12.m により Processing には use / storage が含まれるので、学習データとして使うことも保存することも該当。

**(3) Platform Terms 3.a.v（プロファイル構築）**

> v. Processing Platform Data without valid User consent in order to build or augment user profiles for any purpose.

日本語: 有効なユーザー同意なしに、いかなる目的であれユーザープロファイルを構築・拡張する目的で Platform Data を Processing することは禁止。→ 投稿主の嗜好推定モデル等はここに抵触。

**(4) 参考: 資料1d が唯一許す「分析的」利用の範囲**

> You may also use this permission to request analytics insights to improve your app and for marketing or advertising purposes, through the use of **aggregated and de-identified or anonymized information (provided such data cannot be re-identified)**.

日本語: 例外的に許されるのは「**集計済みかつ非識別化／匿名化された**情報（再識別不能であること）」を使ったアプリ改善・マーケ／広告目的のアナリティクスのみ。生の caption や個別投稿単位のデータを学習に使うのはこの例外に入らない。

なお再識別化は Platform Terms 3.a.vi で明示的に禁止:

> vi. Attempting to decode, circumvent, re-identify, de-anonymize, unscramble, unencrypt, reverse hash, or reverse-engineer Platform Data that is provided to you.

**判定: 「AI/ML」を名指しした条項は該当なし。しかし oEmbed の front-end view 限定条項 + Platform Terms 3.a.viii + 3.a.v の組み合わせにより、oEmbed 経由で取得した caption 等を AI/ML の学習・推論に使うことは実質的に禁止。**

---

## F. 画像そのものをダウンロード・再ホストすることの可否

### F-1. 資料1 — サムネイル URL は既に返らない

資料1c:

> The following fields are no longer returned and will be fully deprecated on November 3, 2025:
> `author_name` / `author_url` / `thumbnail_height` / `thumbnail_url` / `thumbnail_width`

資料1 現行 Fields 一覧（返却されるのは以下のみ）:

> `html` / `provider_name` / `provider_url` / `type` / `version` / `width`

日本語: **`thumbnail_url` は既に返却されなくなっている**（2025-11-03 完全廃止）。つまり oEmbed API から画像 URL を得て自前で落とす経路は、そもそも塞がれている。

### F-2. 資料1 Limitations — 永続化の禁止

> This prohibition encompasses consuming, manipulating, extracting, or **persisting** the metadata and **content** [...]

日本語: メタデータおよび**コンテンツ**の永続化（persisting）が禁止と明記。画像コンテンツを自社ストレージに保存＝ persisting に該当。

### F-3. 資料3 Developer Policies 6. Instagram Platform（最も直接的）

> **6. Instagram Platform**
>
> Comply with any requirements or restrictions imposed on usage of Instagram user photos and videos ("User Content") by their respective owners. You are solely responsible for making use of User Content in compliance with owners' requirements or restrictions.
>
> Don't use the Instagram Platform to simply display User Content, **import or backup content**, or manage Instagram relationships, without our prior permission.

日本語: Instagram のユーザー写真・動画（User Content）について、権利者が課す要件・制限に従うこと。その遵守責任は開発者にある。また **Meta の事前許可なしに、Instagram Platform を単に User Content を表示する目的や、コンテンツをインポート・バックアップする目的で使ってはならない**。→ 画像のダウンロード・自社サーバへの再ホストは "import or backup content" に該当。

### F-4. 資料2 Platform Terms 2.a — ライセンスの範囲

> a. Our License to You. Subject to your compliance with these Terms and all other applicable terms and policies, we grant you a limited, non-exclusive, non-sublicensable [...] non-transferable, non-assignable license to use, access, and integrate with Platform, but only to the extent permitted in these Terms and all other applicable terms and policies. [...] Except as expressly licensed herein, you will not use, access, integrate with, modify, translate, create derivative works of, reverse engineer, or otherwise exploit Platform or any aspect thereof. The Meta Companies reserve all rights, title, and interest (including the right to enforce any such rights) not expressly granted in these Terms.

日本語: Meta から付与されるのは限定的なライセンスのみで、明示的に許諾された範囲を超える利用・改変・二次的著作物の作成は不可。明示的に付与されていない権利はすべて留保される。さらに投稿画像の著作権は投稿者本人にあり、Meta のライセンスとは別に権利者の許諾が必要（F-3 第1文）。

**判定: 画像のダウンロード・再ホストは prohibited。**

---

## 結論 — 本番運用のために満たすべき条件（チェックリスト）

| # | 条件 | 根拠 |
|---|------|------|
| 1 | App Access Token（または Client Token）を用いて `GET /instagram_oembed` を呼ぶ | 資料1b（error 190 / PHP サンプル） |
| 2 | **Meta oEmbed Read** feature で **App Review を通過**する | 資料1d "Requires App Review." |
| 3 | **ビジネス認証（business verification）**を完了する。追加契約の署名を求められる場合あり | 資料1d "only available with business verification" |
| 4 | 返却された `html` を**そのまま**出力し、`embed.js` にレンダリングさせる。帰属表示・ロゴを改変・隠蔽しない | 資料1 Embed JS / 資料3 "Respect the way Meta Products look and function" |
| 5 | caption 等のメタデータを**自社 DB に永続化しない**。表示に必要な一時的取得に留める | 資料1 Limitations（persisting 禁止）/ Platform Terms 3.a.viii |
| 6 | ユーザー／Meta からの削除要求に**速やかに応じる導線**をアプリ内に用意する | Platform Terms 3.d.i.1 |
| 7 | 正当な業務目的が消えた時点・サービス終了時に**全 Platform Data を削除**する | Platform Terms 3.d.i.2.a / 2.b |
| 8 | 取得データを **AI/ML の学習・推論に使わない** | 資料1 Limitations / Platform Terms 3.a.viii / 3.a.v |
| 9 | 画像・動画を**ダウンロードして自社で再ホストしない** | 資料3 §6 "import or backup content" / 資料1 persisting 禁止 |
| 10 | 1時間あたり 1,000 リクエストのレート制限を守る | 資料1 Rate limits |
| 11 | 非公開・休眠・年齢制限アカウント、Embeds 無効アカウント、Stories は対象外として扱う | 資料1 Limitations |

## 未確定・追加調査が必要な点

1. **access level が "Advanced Access" と明記された一次記述は今回の3資料には無い。**
   App Dashboard の Meta oEmbed Read 行に表示される access level を実機で確認すべき。
2. **埋め込み後に投稿が削除された場合の具体的な表示挙動**（プレースホルダの有無等）は
   今回の3資料には記載が無い。実機で削除済み投稿の shortcode を埋め込んで確認するのが確実。
3. **キャッシュ許容期間**を定めた条項は存在しない。期間で判断せず「front-end view に必要な最小限」で設計すること。
4. 資料1 の "Requirements" セクションが実質空である点は、Meta 側のドキュメント不備の可能性がある。
   将来的に内容が追記される可能性があるため、本番リリース前に再確認すること。