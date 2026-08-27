# Instagram（Meta）公式API 能力マトリクス — 第三者アカウントの投稿取得

調査日: 2026-08-27
調査方法: `curl -s -A "nanitabeyo-research/1.0"` による developers.facebook.com の原文取得 + 無認証での実エンドポイント叩き。
現行 Graph API バージョン: **v26.0**（`/docs/graph-api/reference/instagram-oembed` のページタイトルが "Graph API Reference v26.0"）。
なお `developers.facebook.com/docs/...` は現在すべて `developers.facebook.com/documentation/...` へ 301 する。

> **本文書の原則**: 「」内および引用ブロックは取得した原文の逐語。推測は「**[推測なし／明記なし]**」と明示する。

---

## 1. 能力マトリクス

| # | エンドポイント | 第三者の投稿が取れるか | 返る主なフィールド | 必要 Permission | 必要 Feature | Access Level | App Review | Business Verification | 上限 |
|---|---|---|---|---|---|---|---|---|---|
| A | `GET /{ig-user-id}?fields=business_discovery.username(<USERNAME>){media{...}}` | **○ ただし相手が Professional（Business/Creator）のみ** | IG User public fields + `media` エッジ（IG Media public fields） | `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`（BM経由のPage role なら `ads_management` or `ads_read` も） | **記載なし**（Feature 行が reference に存在しない） | 自社ロール保有者のみで運用するなら Standard で足りると読める（→§9で詳述、**明文なし**） | 上記に同じ | Advanced を取るなら必須 | Platform Rate Limits（アプリトークン: `200 × ユーザー数` /時）。**media のページング深度上限は文書に記載なし** |
| B | `GET /ig_hashtag_search?user_id=&q=` | ハッシュタグIDを返すのみ | `id` | `instagram_basic`（+ BM経由なら `ads_management`/`business_management`/`pages_read_engagement`） | **`Instagram Public Content Access`** | Advanced（Feature は App Review 必須） | **必要** | **必要** | **30ユニークハッシュタグ / ローリング7日 / IG User あたり** |
| C | `GET /{ig-hashtag-id}/recent_media` | **○（公開の写真・動画のみ）** | `caption`,`children`,`comments_count`,`id`,`like_count`,`media_type`,`media_url`,`permalink`,`timestamp` | 同上 | 同上 | 同上 | **必要** | **必要** | **直近24時間に公開されたメディアのみ** / 1ページ最大 `limit=50` / 30ハッシュタグ・7日 / `username` 不可 |
| D | `GET /{ig-hashtag-id}/top_media` | **○（公開の写真・動画のみ）** | 同上（C と同じ9フィールド） | 同上 | 同上 | 同上 | **必要** | **必要** | 1ページ最大 `limit=50` / 30ハッシュタグ・7日 / `username` 不可 / 期間制限の記載なし |
| E | `GET /{ig-user-id}/recently_searched_hashtags` | × （自分の検索履歴） | `id` | `instagram_basic` | `Instagram Public Content Access` | Advanced | 必要 | 必要 | 既定25件/ページ、`limit=30` まで |
| F | **location / place 系** | **存在しない** | — | — | — | — | — | — | — |
| G | `GET /instagram_oembed?url=` | **○ 埋め込みHTMLとメタデータのみ**（投稿の一覧・検索は不可） | `html`(required), `provider_name`, `provider_url`, `type`, `version`, `width` | **なし** | 現行ドキュメントに記載なし（`Meta oEmbed Read` の Feature ページは App Review 必須と記載 → §5の齟齬） | **トークン不要**（2026-05-15 changelog / 実測200） | 現行 oEmbed ドキュメント上は記載なし | 同左 | **1,000 リクエスト / 時** |
| H | Instagram API **with Instagram Login**（`graph.instagram.com`） | **× 第三者アカウント不可**（`business_discovery`・hashtag search 非対応） | — | `instagram_business_basic` ほか | — | — | — | — | Instagram Business Use Case rate limiting（`4800 × インプレッション数` /24h） |
| I | Instagram **Basic Display API** | **廃止済（2024-12-04）** | — | — | — | — | — | — | 全リクエストがエラーを返す |

---

## 2. `business_discovery`

URL: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery （301→ `/documentation/...`, HTTP 200）
ガイド: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery （HTTP 200）

### 逐語引用

> Allows you to get data about other Instagram Business or Creator IG Users.
>
> **Available for the Instagram API with Facebook Login.**

> `GET /<IG_USER_ID>?fields=business_discovery.username(<USERNAME>)`
>
> Returns data about another Instagram Business or Creator IG User. Perform this request on the Instagram Business or Creator IG User who is making the query, and identify the targeted business with the `username` parameter.

> ### Limitations
> Data about age-gated Instagram Business IG Users will not be returned.

> ### Permissions
> A Facebook User access token with the following permissions:
> - `instagram_basic`
> - `instagram_manage_insights`
> - `pages_read_engagement`
>
> If the token is from a User whose **Page role was granted via the Business Manager**, one of the following permissions is also required:
> - `ads_management`
> - `ads_read`

**Feature の記載は無い。** `ig_hashtag_search` 等が持つ "Requirements: Features: Instagram Public Content Access" のテーブルが business_discovery reference には存在しない。

### ページネーション（逐語）

> ### Pagination
> The `/media` edge supports cursor-based pagination, so when accessing it via field expansion, the response will include `before` and `after` cursors if the response contains multiple pages of data. Unlike standard cursor-based pagination, however, the response will not include `previous` or `next` fields, so you will have to use the `before` and `after` cursors to construct `previous` and `next` query strings manually in order to page through the returned data set.

**→ 「何件まで遡れるか」「`after` カーソルの上限」は原文に一切記載が無い。** 期間上限・件数上限・最大ページ数のいずれの記述も business_discovery reference およびガイドに存在しない（`grep -i "pagin|cursor|after|limit"` の全ヒットを確認したうえで、上記引用が唯一のページング記述）。実測による確認は本調査ではトークンが無いため未実施（§10）。

### 返るフィールド

**(a) IG User 側**（reference の Fields 表で `Public` 印のあるものが field expansion 経由で返る。URL: `/reference/ig-user`）

| フィールド | Public 印 | 説明（逐語） |
|---|---|---|
| `alt_text` | Public | Descriptive text for images, for accessibility. |
| `biography` | Public | Profile bio text. |
| `followers_count` | Public | Total number of Instagram users following the user. |
| `id` | Public | App-scoped User ID. |
| `media_count` | Public | Total number of IG Media published on your app user's account. |
| `username` | Public | Your app user's Instagram profile username. |
| `website` | Public | Your app user's website URL. |
| `follows_count` / `name` / `profile_picture_url` ほか | Public 印なし | — |

> Public fields can be returned by an edge using field expansion.

**(b) IG Media 側**（URL: `/reference/instagram-media`）

> Public fields can be read via field expansion.

Public 印のあるフィールド: `alt_text`, `caption`, `comments_count`, `id`, `is_shared_to_feed`, `media_audio_type`, `media_product_type`, `media_type`, `media_url`, `owner`, `permalink`, `shortcode`, `thumbnail_url`, `timestamp`, `username`, `view_count`, `reposts_count`, `total_comments_count`, `total_like_count`

nanitabeyo の `dish_media` に直接効くもの（逐語）:

> `media_url` <br>Public | The URL for the media.
> **Warning:** The `media_url` field is omitted from responses if the media contains copyrighted material or has been flagged for a copyright violation.

> `permalink` <br>Public | Permanent URL to the media.

> `shortcode` <br>Public | Shortcode to the media.

> `timestamp` <br>Public | ISO 8601-formatted creation date in UTC.

> `media_type` <br>Public | Media type. Can be `CAROUSEL_ALBUM`, `IMAGE`, or `VIDEO`.

> `view_count` <br>Public | ... Available for **Business Discovery API** only.

`children` エッジも Public:

> `children` <br>Public. | Represents a collection of Instagram Media objects on an album Instagram Media.

### 重要な制約（ガイド原文）

> Note that this does not grant you permission to access media objects directly — performing a `GET` on any returned IG Media will fail due to insufficient permissions.

→ business_discovery で得た media id を単体 `GET /{ig-media-id}` することはできない。フィールドはネスト展開で取り切る必要がある。

### レート上限

`/docs/instagram-platform/overview#rate-limiting` （HTTP 200）:

> All endpoints are subject to Instagram Business Use Case rate limiting **except for Business Discovery and Hashtag Search endpoints, which are subject to Platform Rate limiting.**
> #### Notes
> - Business Discovery and Hashtag Search API are subject to Platform Rate Limits.

`/docs/graph-api/overview/rate-limiting` （HTTP 200）Platform Rate Limits 原文:

> Platform Rate Limits are tracked on an individual application or user level, depending on the type of token used in the request.
> **Applications** — Graph API requests made with an application access token are counted against that app's rate limit. An app's call count is the number of calls it can make during a rolling one hour window and is calculated as follows: **Calls within one hour = 200 * Number of Users**. The Number of Users is based on the number of unique daily active users an app has.
> **Users** — Graph API requests made with a user access token are counted against that user's call count. ... **Due to privacy concerns, we do not reveal actual call count values for users.**

→ business_discovery は User access token で叩くので、**実効上限値は Meta が非公開**。`X-App-Usage` ヘッダで使用率のみ観測可能。

---

## 3. Hashtag Search（`ig_hashtag_search` / `recent_media` / `top_media`）

URL:
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search （HTTP 200）
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent-media （HTTP 200）
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/top-media （HTTP 200）
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search （HTTP 200）

### 審査要件（逐語 / hashtag-search ガイド）

> ## Requirements
> In order to use this API, you must undergo **App Review** and request approval for:
> - the `Instagram Public Content Access` feature
> - the `instagram_basic` permission

### `ig_hashtag_search`（逐語）

> Returns the ID of an IG Hashtag. IDs are both static and global (i.e, the ID for `#bluebottle` will always be `17843857450040591` for all apps and all app users).
>
> #### Limitations
> - You can query a maximum of **30 unique hashtags within a 7 day period**.
> - The API will return a generic error for any queries that include hashtags that we have deemed sensitive or offensive.

Requirements テーブル（逐語）:

| Type | Description |
|---|---|
| Features | `Instagram Public Content Access` |
| Permissions | `instagram_basic` — If the token is from a User whose Page role was granted via the Business Manager, one of the following permissions is also required: `ads_management`, `business_management`, or `pages_read_engagement`. |
| Tokens | A User access token of a Facebook User who has been approved for tasks on the connected Facebook Page. |

### `recent_media` Limitations（逐語 — **取得上限と期間の核心**）

> - Only returns public photos and videos.
> - **Only returns media objects published within 24 hours of query execution.**
> - Will not return promoted/boosted/ads media.
> - **Responses are paginated with a maximum `limit` of 50 results per page.**
> - Responses will not always be in chronological order.
> - You can query a maximum of 30 unique hashtags within a 7 day period.
> - **You cannot request the `username` field on returned media objects.**
> - This endpoint only returns an `after` cursor for paginated results; a `before` cursor will not be included. In addition, **the `after` cursor value will always be the same for each page**, but it can still be used to get the next page of results in the result set.

### `top_media` Limitations（逐語）

> - This edge only returns public photos and videos.
> - Will not return promoted/boosted/ads media.
> - Responses are paginated with a maximum `limit` of 50 results per page.
> - You can query a maximum of 30 unique hashtags within a 7 day period.
> - You cannot request the `username` field on returned media objects.
> - This endpoint only returns an `after` cursor ... the `after` cursor value will always be the same for each page ...

`top_media` に **24時間制限の記載は無い**（recent_media にのみある）。ただし総件数上限の明記も無い。

> Popularity is determined by a mix of views and viewer interaction using the same methodology that determines the top posts when searching for a hashtag on www.instagram.com.

### 返るフィールド（両エッジ共通、逐語の値リスト）

`caption` / `children` / `comments_count` / `id` / `like_count` / `media_type` / `media_url` / `permalink` / `timestamp`

→ **`username` は取得不可**。すなわちハッシュタグ経由では「どの店舗アカウントの投稿か」を API 単体では特定できない。

### 週あたりのハッシュタグ数制限（逐語 / hashtag-search ガイド）

> You can query a maximum of **30 unique hashtags on behalf of an Instagram Business or Creator Account within a rolling, 7 day period**. Once you query a hashtag, it will count against this limit for 7 days. Subsequent queries on the same hashtag within this time frame will not count against your limit, and will not reset its initial query 7 day timer.

その他（逐語）:
> - You cannot comment on hashtagged media objects discovered through the API.
> - Hashtags on Stories are not supported.
> - Emojis in hashtag queries are not supported.

### `Instagram Public Content Access` Feature（逐語）

URL: https://developers.facebook.com/docs/apps/features-reference/instagram-public-content-access （HTTP 200）

> **Requires App Review.** The Instagram Public Content Access feature allows your app to access Instagram Graph API's Hashtag Search endpoints. The allowed usages for this feature is to discover content associated with your hashtag campaigns, understand public sentiment around your brand or identify contest, competition and sweepstakes entrants. It can also be used to provide customer support and better understand and manage your audience.
>
> **Allowed Usage**: Discover content associated with its current campaign. Provide customer support. Identify entrants to its contests, competitions, or sweepstakes. Understand public sentiment around brand. Understand and manage their audience, develop their content strategy and obtain digital rights.
>
> **Common Endpoints**: /ig-hashtag-search /ig-hashtag /ig-hashtag/recent-media /ig-hashtag/top-media
>
> **Additional Details**: This permission or feature requires successful completion of the App Review process before your app can access live data. **This permission or feature is only available with business verification.** You may also need to sign additional contracts before your app can access data.

→ 前提として渡された「Advanced Access + ビジネス認証 + Instagram Public Content Access が要るらしい」は**原文で裏付けられる**。加えて Allowed Usage が「自社ハッシュタグキャンペーン／自社ブランドの言及／コンテスト参加者」に限定列挙されており、**「他店の料理写真を収集して自社アプリに掲載する」は列挙された Allowed Usage のいずれにも該当しない**（列挙は原文どおり。該当可否の判断は本文書では下さない）。

---

## 4. location / place 系

### 結論: **Instagram Platform に場所IDから投稿を引くエンドポイントは存在しない。**

根拠1 — API リファレンス索引の全量（URL: https://developers.facebook.com/docs/instagram-platform/reference 、HTTP 200）。逐語:

> ## Nodes
> | IG Comment | IG Container | IG Hashtag | IG Media | IG User | Page |
>
> ## Root Edges
> | `ig_hashtag_search` | Gets the ID of an IG Hashtag. Only available for Instagram API with Facebook Login. |

→ **Node は6つ、Root Edge は `ig_hashtag_search` 1つのみ。** location / place の Node も Root Edge も無い。

根拠2 — IG Media reference（URL: `/docs/instagram-platform/reference/instagram-media`、HTTP 200）冒頭の逐語:

> The following Marketing API Instagram Ads endpoint fields are **not supported**:
> * `filter_name`
> * **`location`**
> * **`location_name`**
> * **`latitude`**
> * **`longitude`**

→ 取得側でも位置情報フィールドは返らない。

根拠3 — Content Publishing ドキュメント（URL: `/docs/instagram-platform/content-publishing`、HTTP 200、19,206 bytes）を `grep -ci location` した結果 **0件**。2018-11 の changelog には

> **Content Publishing API** — Beta partners can now use the `/{ig-user-id}/media` edge to tag locations and public Instagram users when publishing photos.

とあり `#publish-with-locations` アンカーへリンクしているが、**現行ページに該当セクションは残っていない**（位置タグ付けの公開ドキュメントは消滅）。

根拠4 — Instagram Platform changelog 全文（750行）を `grep -i location` した結果、ヒットは3件のみで、いずれも `media_product_type`（公開面）の説明か上記2018年の投稿側記述であり、**場所からメディアを読むエンドポイントの記載は一件も無い**。

旧 Legacy Instagram API（`/locations/{location-id}/media/recent` 等）については、changelog に

> The Legacy Instagram API developer documentation has been removed and now redirects to the Instagram Platform developer documentation.

とある。**個別エンドポイントの廃止告知原文は本調査では取得できなかった**（§10）。

---

## 5. `instagram_oembed` — 2026年時点のトークン要否

URL: https://developers.facebook.com/docs/instagram-platform/oembed （HTTP 200）
リファレンス: https://developers.facebook.com/docs/graph-api/reference/instagram-oembed （HTTP 200、"Graph API Reference v26.0"）

### トークン要否 — **不要になった**

Instagram Platform changelog（URL: `/docs/instagram-platform/changelog`、HTTP 200）の逐語:

> ## May 15, 2026
> ### oEmbed API
> *Applies to all versions.*
> **You can now call Instagram oEmbed API without an access token.** See Embed an Instagram Post for more details.

**実測（2026-08-27）**:

```
$ curl -s -A "nanitabeyo-research/1.0" -w "HTTP:%{http_code}" \
  "https://graph.facebook.com/v26.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FfA9uwTtkSN%2F"
→ HTTP:200  （version/provider_name/provider_url/type/width/html を含む正常なJSON）

$ ... "?url=https%3A%2F%2Fwww.instagram.com%2Fstarbucks"   → HTTP:200
$ ... "?url=https%3A%2F%2Fwww.instagram.com%2Fnatgeo"      → HTTP:200
```

存在しないショートコードは `HTTP:400` / `code:24, error_subcode:2207045, "Media Not Found"` を返す（＝認証エラーではなくメディア不在エラー）。不正なトークンを付けた場合のみ `code:190 "Invalid OAuth access token"`。

また現行の "Embed an Instagram Post" ページ本文には **"token" / "App Review" / "feature" の文字列が1つも出現しない**（`grep -oi` で 0 ヒット）。

### ただし Feature ページとの齟齬（両方を原文で提示する）

`Meta oEmbed Read` Feature ページ（URL: https://developers.facebook.com/docs/features-reference/meta-oembed-read 、HTTP 200）は依然として:

> **Requires App Review.** The oEmbed Read feature allows your app to get embed HTML and basic metadata for public Facebook and Instagram pages, posts, and videos. The allowed usage for this feature is to provide front-end views of Facebook and Instagram pages, posts, and videos.
>
> **Additional Details**: This permission or feature requires successful completion of the App Review process before your app can access live data. **This permission or feature is only available with business verification.**

→ **changelog（トークン不要）と Feature ページ（App Review + business verification 必須）は文面上整合していない。** どちらが優先するかは Meta の原文からは判定できない（**不明**）。実測ではトークン無しで 200 が返る。

### Limitations（原文・逐語 / 全文）

> ### Limitations
> * The Instagram oEmbed endpoint is **only** meant to be used for embedding Instagram content in websites and apps. It is not to be used for any other purpose. **Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other than providing a front-end view of the page, post, or video is strictly prohibited**. This prohibition encompasses consuming, manipulating, extracting, or persisting the metadata and content, including but not limited to deriving information about pages, posts, and videos from the metadata for analytics purposes.
> * Posts on private, inactive, and age-restricted Instagram accounts are not supported.
> * Accounts that have disabled **Embeds** are not supported.
> * Stories are not supported.
> * Shadow DOM is not supported.
>
> ### Rate limits
> **You can make up to 1,000 requests every hour.**

### 返るフィールド（reference の逐語）

| Field | 種別 | 説明 |
|---|---|---|
| `html` | **Required** | The HTML used to display the post. |
| `provider_name` | Default | Name of the provider (Instagram) |
| `provider_url` | Default | URL of the provider (Instagram) |
| `type` | Default | The oEmbed resource type. |
| `version` | Default | Always 1.0. |
| `width` | Default | The width in pixels required to display the HTML. |

パラメータ: `hidecaption`(bool) / `maxwidth`(int64, **320〜658**、`maxheight` は非対応) / `omitscript`(bool) / `url`(URI)

受け付ける URL 形式（逐語）:
> * Single image and carousel posts: `https://www.instagram.com/p/{media-shortcode}/`
> * Videos/Reels: `https://www.instagram.com/reel/{media-shortcode}/`
> * Profiles: `https://www.instagram.com/{username}`

**削除されたフィールド**（URL: https://developers.facebook.com/blog/post/2025/04/08/oembed-updates/ 、HTTP 200、逐語）:

> Update: October 8, 2025 — To give developers more time to complete their migration, we are extending the deadline for changes to the oEmbed Read feature. Developers will now be automatically migrated to **Meta oEmbed Read**, which will replace oEmbed Read, on **November 3, 2025**. After this date, the following fields will no longer be returned from the oEmbed response from Facebook post, Facebook videos, and Instagram post: `author_name` `author_url` `thumbnail_height` `thumbnail_url` `thumbnail_width`

→ **oEmbed からはサムネイル URL も投稿者名も取れなくなった。** 実測レスポンスにも含まれない。

---

## 6. Instagram Login と Facebook Login の違い

URL: https://developers.facebook.com/docs/instagram-platform/overview （HTTP 200）

Overview の比較表（逐語、抜粋）:

| Component | Instagram API setup with **Instagram Login** | Instagram API setup with **Facebook Login** |
|---|---|---|
| Access token type | Instagram User | Facebook User or Page |
| Authorization type | Business Login for Instagram | Facebook Login for Business |
| Facebook Page | x | **Required** |
| **Hashtag search** | **x** | **✅** |
| Comment moderation / Content publishing / Insights / Mentions | ✅ | ✅ |
| Product tagging / Partnership Ads | x | ✅ |

Base URL（逐語）:
> For apps using Business Login for Instagram ... all endpoints are accessed via the **`graph.instagram.com`** host.
> For apps using Facebook Login for Business ... all endpoints are accessed via the **`graph.facebook.com`** host.

### 第三者アカウントの投稿取得に使えるのは **Facebook Login 側のみ**

- `business_discovery` reference 逐語: 「**Available for the Instagram API with Facebook Login.**」
- `IG Hashtag` reference の Limitations 逐語: 「**Only available for Facebook Login for Business**」
- Reference 索引 逐語: 「`ig_hashtag_search` | ... **Only available for Instagram API with Facebook Login.**」
- Instagram Login のページ（URL: `/docs/instagram-platform/instagram-api-with-instagram-login`、HTTP 200）が挙げる機能は Comment moderation / Content publishing / Media Insights / Mentions / Messaging のみで、**business_discovery も hashtag search も列挙されていない**。Limitations は「This API setup cannot access ads or tagging.」

Facebook Login 側の Common Uses（逐語）:
> - Getting basic data about other Instagram Business and Creator accounts
> - Discovering hashtagged media
> - Discovering @mentions

Limitations（逐語）:
> - The Instagram API with Facebook Login **cannot access Instagram consumer accounts** (i.e., non-Business or non-Creator Instagram accounts).
> - Ordering results is not supported
> - All endpoints support cursor-based pagination, but the User Insights edge is the only endpoint that supports time-based pagination

Permission セット（Overview 逐語）:

| Instagram login | Facebook login |
|---|---|
| `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, Human Agent | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, Human Agent, **Instagram Public Content Access** |

---

## 7. Professional アカウントの割合に関する Meta の公表値

### **見つからなかった。**

- developers.facebook.com 配下の取得済みドキュメント（Overview / Instagram Platform root / IG User reference / changelog 全750行）に、Professional アカウント数・比率の記載は無い。
- `about.fb.com` / `investor.atmeta.com` / `business.instagram.com` / `about.instagram.com` / `developers.facebook.com` に限定した検索でも、該当する数値の公表ページは返らなかった。
- `https://investor.atmeta.com/investor-news/` は **HTTP 403**（curl 直取得不可）。
- `https://www.facebook.com/business/help/1595939375940958` は **HTTP 404**。

→ **不明。Meta の一次資料で Professional アカウントの割合を示す公表値は本調査では確認できなかった。**（第三者調査会社の推計値は一次資料ではないため本文書には記載しない。）

なお、割合の代わりに使える定性的な事実は原文にある:
> The Instagram API with Facebook Login cannot access Instagram consumer accounts (i.e., non-Business or non-Creator Instagram accounts).
> This API returns only data for media owned by Instagram professional accounts. It can not be used to get data for media owned by personal Instagram accounts.

---

## 8. Standard Access と Advanced Access の境目

URL: https://developers.facebook.com/docs/graph-api/overview/access-levels （HTTP 200）

### 逐語（access-levels ページ）

> Access levels are an additional layer of Graph API authorization that apply to permissions and features for Business, Consumer, and Gaming apps.
>
> There are two access levels: **Standard** and **Advanced**. Apps can request permissions with Advanced Access from any app user, and features with Advanced Access are active for all app users. **Permissions with Standard Access, however, can only be requested from app users who have a role on the requesting app, and features with Standard Access are only active for app users who have a role on the app.**
>
> If your app will only be used by people who have a role on it, the permissions and features your app requires will only need Standard Access. If your app will be used by people who do not have a role on it, the permissions and features that your app requires will need Advanced Access.
>
> **All Business, Consumer, and Gaming apps are automatically approved for Standard Access for all permissions and features.** Advanced Access, however, must be approved on an individual permission and feature basis through the App Review process.

> ### Advanced Access
> Permissions with Advanced Access can be requested from any app user, and features with Advanced Access are active for all app users. However, **Business Verification is required to get Advanced Access.** In some cases additional App Review on an individual permission and feature basis might be required.

> ### Data Use Checkup
> Apps that have Advanced Access for a permission or feature must complete **Data Use Checkup**, which is an **annual** process to certify that the app accesses Facebook APIs, products, and data in compliance with our Platform Terms and Developer Policies.

> **Advanced Access now requires Business Verification** — As of February 1, 2023 apps requesting advanced access for permissions may have to be connected to a verified business.

### Instagram Platform Overview 側の逐語

> **Standard Access** — Standard Access is the default access level for all apps and limits the data your app can get. It is intended for apps that will only be used by people who have roles on them, during app development, or for testing your app. **If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs.**
>
> **Advanced Access** — Advanced Access is the access level required **if your app serves Instagram professional accounts that you don't own or manage** and can be used by app users who do not have a role on your app or a role on a business portfolio that has claimed your app. **This access level requires App Review and Business Verification.**
>
> **Note:** Because of the limited scope of Standard Access, some features might not work properly until your app has been granted Advanced Access.

### 境目の整理

| | Standard Access | Advanced Access |
|---|---|---|
| 誰が権限を付与できるか | **アプリにロールを持つ人だけ** | 誰でも |
| Feature が有効になる相手 | アプリにロールを持つ人だけ | 全 app user |
| App Review | 不要（自動承認） | 個別に必要 |
| Business Verification | 不要 | **必須** |
| Data Use Checkup | 不要 | 年次で必須 |

**重要な区別**: Access Level が制御するのは「**トークンを渡す app user**」であって「**business_discovery が読みに行く相手のアカウント**」ではない。原文が Advanced を要求するのは "if your app serves Instagram professional accounts that you don't own or manage"（＝他人の口座を app user として抱える場合）である。

---

## 9. App Review / Business Verification の要否と法人登記

URL:
- https://developers.facebook.com/docs/app-review （301→ `/documentation/resp-plat-initiatives/individual-processes/app-review`、HTTP 200）
- https://developers.facebook.com/docs/development/release/business-verification （HTTP 200）
- https://www.facebook.com/business/help/1095661473946872 （HTTP 200）

### どれに必要か

| 対象 | App Review | Business Verification |
|---|---|---|
| `instagram_oembed`（現行 oEmbed ドキュメント） | 記載なし（トークン不要と changelog 明記） | 記載なし |
| `Meta oEmbed Read` Feature（Feature ページ） | **必須と明記** | **必須と明記** |
| `Instagram Public Content Access`（hashtag 全系統） | **必須と明記** | **必須と明記** |
| `business_discovery`（reference に Feature 記載なし） | 使う permission を Advanced にするなら必要 | Advanced を取るなら必要 |
| 全 permission の Advanced Access | 個別に必要 | **必須** |

### Business Verification と法人登記（逐語）

`/docs/development/release/business-verification`:

> Business Verification is a process that allows us to gather information about you and your Business so we can verify your identity as a business entity.
>
> Apps that request advanced access for permissions and apps that allow other Businesses to access their own data must be connected to a Business that has completed Business Verification. Until then, **app users from other Businesses will be unable to grant these apps permissions and all features will be inactive.**
>
> **If your app will only be used by app users who have a role on the app itself you do not need to complete verification; these users can grant your app any permissions at any time and all features are always active.**

`facebook.com/business/help/1095661473946872`（逐語）:

> Verifying your business helps:
> - **Ensure your business is a legal entity. Your business needs to be registered with local authorities and you'll need an official phone number or mailing address for your business.**
> - Demonstrate you're an authorized representation of your business. You'll need to be able to receive a verification code sent to the phone number or email address of your business, or verify your business portfolio's domain.
>
> **Eligible developer features** — **Verification is required to obtain Advanced Access for any permission on Meta for Developers.**

→ **法人登記は必要。** 「registered with local authorities」＝現地当局への事業者登録が明文の要件。

### Permissions Reference 冒頭の要件（逐語）

> **Requirements**
> - Meta App Review – For apps that needs access to data that you do not own or manage
> - Business Verification – is required for all apps making requests for Advanced Access

### App Review が通らない場合の逃げ道（Overview 逐語）

> #### Private apps
> If reviewers are unable to test your app because it is behind a private intranet, has no user interface, or has not implemented Facebook Login for Business, you can request approval only for the following permissions:
> * `instagram_basic`
> * `instagram_manage_comments`

→ Private app 扱いでは `instagram_manage_insights`（business_discovery に必要）も `Instagram Public Content Access` も申請できない。

---

## 10. 廃止・変更されたものと代替

Instagram Platform changelog（URL: https://developers.facebook.com/docs/instagram-platform/changelog 、HTTP 200、750行）からの逐語。

| 日付 | 廃止・変更 | 逐語 | 代替 |
|---|---|---|---|
| **2026-05-15** | oEmbed のトークン要件撤廃 | "You can now call Instagram oEmbed API without an access token." | — |
| **2025-11-03** | `oEmbed Read` Feature → `Meta oEmbed Read` | "The current oEmbed Read feature will be deprecated on November 3, 2025." / "Existing apps that already use the current oEmbed Read feature will be automatically updated to the new Meta oEmbed Read feature by November 3, 2025." | `Meta oEmbed Read` |
| **2025-11-03** | oEmbed レスポンスからフィールド削除 | "The `author_name`, `author_url`, `thumbnail_url`, `thumbnail_width`, and `thumbnail_height` fields will be removed from the Facebook post, Facebook video, and Instagram post oEmbed response. **The Facebook page post oEmbed endpoint will be deprecated.** These changes will apply across all API versions on November 3, 2025." | 代替なし |
| **2025-01-27** | Instagram Login の旧 scope 値廃止 | "the old scope values will be deprecated on January 27, 2025" | `instagram_business_basic` 等の新 scope |
| **2024-12-04** | **Instagram Basic Display API 廃止** | "The Instagram Basic Display API has been deprecated. **All requests to the Instagram Basic Display API will return an error message.** We recommend that you migrate your app to the **Instagram API** to avoid any disruption to your services." | Instagram API（with Instagram Login / with Facebook Login） |
| （日付は changelog 中の見出し） | Instagram v1.0 API | "The Instagram v1.0 API is deprecated." | Instagram Platform endpoints |
| 同上 | Marketing API の IG エンドポイント | "`GET /{ad account id}/instagram-accounts`, `GET /{ad account id}/connected-instagram-accounts-with-iabp`, `POST /{page-id}/page-backed-instagram-accounts`, `DELETE /{business-id}/instagram-accounts` — Please migrate your API calls to the Instagram Platform endpoints." | Instagram Platform endpoints |
| 同上 | Legacy Instagram API ドキュメント | "The Legacy Instagram API developer documentation has been removed and now redirects to the Instagram Platform developer documentation." | — |

**URL リダイレクトの実測**:
```
/docs/instagram-basic-display-api  → HTTP 200, FINAL: /documentation/instagram-platform
/docs/instagram-api                → HTTP 200, FINAL: /documentation/instagram-platform/instagram-api-with-facebook-login
```
→ Basic Display API の専用ドキュメントは**消滅**し、Instagram Platform のトップへ吸収された。

---

## 11. 結論 — 審査なし（Standard Access）で第三者の店舗アカウント投稿を取れる経路

### 経路①: `instagram_oembed` — **完全に審査なし・トークンなしで通る（実測確認済み）**

| 項目 | 値 |
|---|---|
| トークン | **不要**（2026-05-15 changelog 明記 + 2026-08-27 実測 HTTP 200） |
| App Review | 現行 oEmbed ドキュメントに記載なし（※ Feature ページとは齟齬あり、§5） |
| Business Verification | 同上 |
| レート上限 | **1,000 req/hour** |
| 取れるもの | 埋め込み `html` のみ。`provider_name`/`provider_url`/`type`/`version`/`width` |
| **取れないもの** | 画像URL、投稿者名、サムネイル、キャプション、投稿日時、いいね数（**すべて 2025-11-03 に削除済 or 元から非提供**） |
| **投稿の発見・列挙** | **不可**。投稿の permalink を**すでに知っている**ことが前提 |
| 決定的な制約 | 「**consuming, manipulating, extracting, or persisting the metadata and content**」が明文で禁止。**persisting（永続化）が明示的に禁止対象** |

→ nanitabeyo の「画像は保存せず URL だけ持って公式 embed で表示する」設計に対し: **oEmbed のレスポンスを DB に保存することは Limitations の "persisting" に該当する**。permalink 自体を別経路（自社取得）で持ち、表示のたびに oEmbed を叩く（またはトークン不要になった今は `<blockquote class="instagram-media">` を自前組立て + embed.js）なら Limitations の "providing a front-end view" に収まる。**ただしこの適合判断は Meta の原文が下しているものではない — 原文は上記引用のみである。**

### 経路②: `business_discovery` — **条件付きで Standard Access 圏内**

原文が確立している事実:
1. 「Permissions with Standard Access ... can only be requested from **app users who have a role on the requesting app**」（access-levels）
2. 「If your app only serves **your** Instagram professional account or an account you manage, **Standard Access is all your app needs**」（IG Platform Overview）
3. `business_discovery` は **自社の IG User ID に対して**実行し、相手は `username` パラメータで指定する（reference）
4. `business_discovery` reference に **Feature の要件記載は無い**（PPCA は不要）

→ したがって「自社が保有する Instagram professional アカウント1つ（アプリにロールを持つユーザーが所有）のトークンで、他店の professional アカウントを `business_discovery` で読む」構成は、**論理的には Standard Access の定義内に収まる**。

**⚠️ ただしこれは原文に明記されていない。** Meta のドキュメントは「business_discovery が Standard Access で動く」とも「動かない」とも書いていない。Overview には次の警告もある:

> **Note:** Because of the limited scope of Standard Access, some features might not work properly until your app has been granted Advanced Access.

→ **実測での検証が必須**。本調査ではアクセストークンが無いため未検証（§12）。

この経路が成立する場合に取れるもの:
- 相手の `username`, `followers_count`, `media_count`, `biography`, `website`, `alt_text`
- `media` エッジ経由で各投稿の `media_url`, `permalink`, `shortcode`, `caption`, `timestamp`, `media_type`, `children`, `comments_count`, `like_count`, `view_count`
- **料理画像の URL（`media_url`）と permalink が両方取れる唯一の Standard 圏内経路**

制約:
- 相手が **Professional（Business/Creator）である場合のみ**。個人アカウントは返らない
- 年齢制限アカウントは返らない
- 返った media id を単体 `GET` することはできない
- **遡れる件数の上限は不明**（文書に記載なし）
- Facebook Page と紐付いた IG professional アカウント + Facebook Login for Business の実装が必要

### 経路③: hashtag search — **Standard Access では不可**

`Instagram Public Content Access` Feature が必須で、Feature ページに「Requires App Review」「only available with business verification」と明記。加えて Allowed Usage が自社キャンペーン／自社ブランド／コンテストに限定列挙されている。**飲食店の料理写真の網羅収集は列挙された用途に含まれない。**

### 経路④: location / place — **経路そのものが存在しない**

### まとめ表

| 経路 | 審査 | ビジネス認証 | 投稿の**発見** | 画像URL | permalink | 実用可否 |
|---|---|---|---|---|---|---|
| `instagram_oembed` | **不要** | **不要** | **不可** | 取れない | 入力として必要 | 表示のみ。収集不可 |
| `business_discovery` | 不要（Standard 圏内と読めるが**明文なし**） | 不要（同上） | **可（アカウント単位）** | **`media_url` 可** | **可** | **最有力。ただし相手が Professional 限定 + 要実測** |
| hashtag search | **必要** | **必要** | 可（24h以内/公開のみ） | 可 | 可 | 用途要件に不適合 |
| location / place | — | — | — | — | — | **存在しない** |

**→ 「審査なし（Standard Access）で第三者の店舗アカウントの投稿を取れる経路」は、実質的に `business_discovery` の一本のみ**（相手が Professional アカウントであることが必要、かつ Standard で動作するかは要実測）。oEmbed は「すでに知っている投稿を表示する」ためのものであって、取得経路ではない。

---

## 12. 取得できなかったもの・不明なもの

| # | 対象 | 状況 |
|---|---|---|
| 1 | **`business_discovery` の `media` ページネーション深度上限 / `after` カーソルの上限** | **文書に記載なし。** business_discovery reference・ガイドの全文を確認したが、記述は「cursor-based pagination で before/after が返る、previous/next は返らない」のみ。件数・期間・ページ数の上限は一切書かれていない。実測にはアクセストークンが必要だが、リポジトリ内に `.env` は存在せず（`measure_ig_business_discovery.py` は `IG_TOKEN`/`IG_USER_ID` を環境変数から読むが未設定）、環境変数にも未設定のため**未検証** |
| 2 | **`business_discovery` が Standard Access で実際に動作するか** | **文書に明記なし。** access-levels の一般規則からは動くと読めるが、Meta は個別に述べていない。要実測 |
| 3 | **`top_media` が何件まで返すか（総数上限）** | **文書に記載なし。** 1ページ50件という記載のみ |
| 4 | **User access token の Platform Rate Limit 実数値** | Meta が明示的に非公開: 「Due to privacy concerns, we do not reveal actual call count values for users.」 |
| 5 | **Professional アカウントの割合に関する Meta 公表値** | 見つからず。`investor.atmeta.com/investor-news/` は **HTTP 403**、`facebook.com/business/help/1595939375940958` は **HTTP 404** |
| 6 | **Meta Platform Terms 本文** | `https://developers.facebook.com/terms/` は **HTTP 200 だが本文が JS レンダリングでHTML内に無い**（203,869 bytes 中に "cache"/"oEmbed" の文字列なし）。CORSプロキシも失敗: `api.codetabs.com` → **HTTP 522**、`api.allorigins.win` → **HTTP 520** |
| 7 | **Instagram Platform 専用のレート制限ページ** | 存在しない。`/docs/instagram-platform/rate-limiting` → **HTTP 404**、`/docs/instagram-platform/instagram-graph-api/rate-limiting` → **HTTP 404**。レート制限は Overview の `#rate-limiting` セクションと Graph API 共通ページに統合されている |
| 8 | **Graph API `/search` エンドポイントの現行リファレンス** | `/docs/graph-api/reference/v26.0/search` → **HTTP 404** |
| 9 | **Facebook Places Search API** | `/docs/places/web/search` → **HTTP 404**（ページ消滅） |
| 10 | **Legacy Instagram API の location エンドポイント廃止告知の原文** | 個別告知は取得できず。changelog には「Legacy Instagram API developer documentation has been removed and now redirects to the Instagram Platform developer documentation」とのみ |
| 11 | **oEmbed のトークン要否に関する changelog と Feature ページの齟齬の解消** | どちらが優先するか **Meta の原文からは判定不能**。実測ではトークン無しで 200 |

---

## 付録: 取得した一次資料 URL 一覧（全て 2026-08-27 取得）

| ドキュメント | URL | HTTP |
|---|---|---|
| IG User Business Discovery | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery | 200 |
| Business Discovery ガイド | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery | 200 |
| IG User リファレンス | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user | 200 |
| IG Media リファレンス | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media | 200 |
| IG User Media エッジ | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media | 200 |
| IG Hashtag Search | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search | 200 |
| IG Hashtag | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag | 200 |
| IG Hashtag Recent Media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent-media | 200 |
| IG Hashtag Top Media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/top-media | 200 |
| Recently Searched Hashtags | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/recently_searched_hashtags | 200 |
| Hashtag Search ガイド | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search | 200 |
| Reference 索引 | https://developers.facebook.com/docs/instagram-platform/reference | 200 |
| Embed an Instagram Post (oEmbed) | https://developers.facebook.com/docs/instagram-platform/oembed | 200 |
| instagram_oembed リファレンス | https://developers.facebook.com/docs/graph-api/reference/instagram-oembed | 200 |
| oEmbed Updates ブログ | https://developers.facebook.com/blog/post/2025/04/08/oembed-updates/ | 200 |
| Meta oEmbed Read Feature | https://developers.facebook.com/docs/features-reference/meta-oembed-read | 200 |
| oEmbed Read Feature（旧） | https://developers.facebook.com/docs/features-reference/oembed-read | 200 |
| Instagram Platform Overview | https://developers.facebook.com/docs/instagram-platform/overview | 200 |
| Instagram Platform changelog | https://developers.facebook.com/docs/instagram-platform/changelog | 200 |
| Instagram API with Instagram Login | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login | 200 |
| Instagram API with Facebook Login | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login | 200 |
| Instagram Public Content Access | https://developers.facebook.com/docs/apps/features-reference/instagram-public-content-access | 200 |
| Access Levels | https://developers.facebook.com/docs/graph-api/overview/access-levels | 200 |
| Graph API Rate Limiting | https://developers.facebook.com/docs/graph-api/overview/rate-limiting | 200 |
| Business Verification | https://developers.facebook.com/docs/development/release/business-verification | 200 |
| About business verification（Help） | https://www.facebook.com/business/help/1095661473946872 | 200 |
| Permissions Reference | https://developers.facebook.com/docs/permissions/reference/instagram_basic | 200 |
| App Review | https://developers.facebook.com/docs/app-review | 200 |
| Content Publishing | https://developers.facebook.com/docs/instagram-platform/content-publishing | 200 |
| Instagram Basic Display API（廃止） | https://developers.facebook.com/docs/instagram-basic-display-api | 200（Platform トップへ 301） |

**取得失敗**: `/docs/instagram-platform/rate-limiting` (404), `/docs/instagram-platform/instagram-graph-api/rate-limiting` (404), `/docs/graph-api/reference/v26.0/search` (404), `/docs/places/web/search` (404), `https://www.facebook.com/business/help/1595939375940958` (404), `https://investor.atmeta.com/investor-news/` (403), `https://developers.facebook.com/terms/` (200 だが本文取得不可; プロキシ 522/520)
