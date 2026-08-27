# Instagram business_discovery 一次資料調査

調査日: 2026-08-27 / 調査者: 無人実行 Claude（Chrome 経由で developers.facebook.com を閲覧）

## 参照した URL と結果

| # | 指定 URL | 結果 |
|---|---|---|
| 1 | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/guides/business-discovery | **404（取得不可）**「ページが見つかりません」 |
| 2 | https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/business_discovery | **404（取得不可）** |
| 3 | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery | 404（同上） |

代替として、現行の正規 URL（`/docs/` → `/documentation/` に移行済み）で本文を取得した:

- **[参照 R1] IG User Business Discovery（リファレンス, Updated: Aug 12, 2026）**
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- **[参照 R2] Business Discovery（ガイド, Updated: Aug 12, 2026）**
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery
- **[参照 R3] IG User（ノードのフィールド一覧, Updated: Apr 22, 2026）**
  https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
- **[参照 R4] App Review for Instagram API（Updated: Jun 30, 2026）**
  https://developers.facebook.com/documentation/instagram-platform/app-review
- **[参照 R5] Access Levels**
  https://developers.facebook.com/docs/graph-api/overview/access-levels
- **[参照 R6] Permissions Reference for Meta Technologies APIs**
  https://developers.facebook.com/docs/permissions
- **[参照 R7] Instagram Platform Overview（Rate Limiting セクション）**
  https://developers.facebook.com/documentation/instagram-platform/overview
- **[参照 R8] Rate Limits - Graph API**
  https://developers.facebook.com/docs/graph-api/overview/rate-limiting

---

## A. 必要な permission

> [R1] **Permissions**
> A Facebook User access token with the following permissions:
> - `instagram_basic`
> - `instagram_manage_insights`
> - `pages_read_engagement`
>
> If the token is from a User whose Page role was granted via the Business Manager, one of the following permissions is also required:
> - `ads_management`
> - `ads_read`

日本語: business_discovery には Facebook User アクセストークン＋ instagram_basic / instagram_manage_insights / pages_read_engagement の3つが必須で、Page 権限をビジネスマネージャ経由で付与された場合のみ ads_management か ads_read も追加で必要。

> [R2] Endpoints
> `GET /<YOUR_APP_USERS_IG_USER_ID>/business_discovery`
> Refer to the endpoint's reference documentation for parameter and permission requirements.

日本語: ガイド側は permission を列挙せず、リファレンス（R1）を見よと書いてある。

> [R1] Reading
> `GET /<IG_USER_ID>?fields=business_discovery.username(<USERNAME>)`
> Returns data about another Instagram Business or Creator IG User. Perform this request on the Instagram Business or Creator IG User who is making the query, and identify the targeted business with the `username` parameter.

日本語: リクエストは「自分（アプリ利用者）の IG プロフェッショナルアカウント ID」に対して行い、相手は username パラメータで指定する。＝自分のトークンで他店を引く経路であることが明記されている。

> [R1] Query String Parameters
> `<USERNAME>` (required) — The username of the Instagram Business or Creator IG User you want to get data about.

日本語: username は必須パラメータ。

**注記:** この経路は Instagram API **with Facebook Login** 専用。R1 冒頭に "Available for the Instagram API with Facebook Login." とあり、Instagram Login（graph.instagram.com / instagram_business_basic）側には business_discovery が存在しない。よって Facebook ページ連携済みの IG プロフェッショナルアカウントと Facebook ログインが前提。

---

## B. Access level（Standard で足りるか）

**business_discovery のページ自体（R1・R2）には access level に関する記述は「記載なし」。** 以下は Instagram Platform 全体の App Review ドキュメント（R4）と Graph API の Access Levels（R5）からの引用。

> [R4] Your app must complete App Review before it can request permissions with Advanced Access from any app user and features with Advanced Access are active for all app users.

日本語: 任意のアプリ利用者から Advanced Access の permission を要求するには App Review が必須。

> [R4] **Development scenarios**
> | Development scenario | Login type | Access level | App Review |
> |---|---|---|---|
> | My app is only for a business I own or manage. | No login or Instagram Login | Standard Access | Not required |
> | My app is only for a business I own or manage. | No login or Facebook Login | **Standard Access** | **Not required** |
> | I am a Tech Provider and my app serves multiple businesses. | Instagram Login | Advanced Access | Required |
> | I am a Tech Provider and my app serves multiple businesses. | Facebook Login | Advanced Access | Required |

日本語: 「自分が所有・管理するビジネスのためだけのアプリ」なら Facebook Login でも **Standard Access のままで App Review 不要**。複数事業者に提供する Tech Provider の場合のみ Advanced Access＋審査が必要。

> [R5] Standard Access
> Permissions with Standard Access can only be requested from app users who have a role on the requesting app. Similarly, features with Standard Access are only active for app users who have a role on the app.
> Business, Consumer, and Gaming apps are automatically approved for Standard Access for all permissions and features available to their app type.
> Standard Access is intended for apps that will only be used by people who have roles on them, or used during app development, when testing API endpoints that the calling app has not been approved for.

日本語: Standard Access は「そのアプリにロールを持つ人」からしか permission を要求できないが、Business/Consumer/Gaming アプリは全 permission について自動的に Standard Access が承認済み。

> [R5] Advanced Access
> Permissions with Advanced Access can be requested from any app user, and features with Advanced Access are active for all app users. However, Business Verification is required to get Advanced Access. In some cases additional App Review on an individual permission and feature basis might be required.

日本語: Advanced Access は誰からでも permission を要求できるが、Business Verification（ビジネス認証）が必須。

> [R5] All Business, Consumer, and Gaming apps are automatically approved for Standard Access for all permissions and features. Advanced Access, however, must be approved on an individual permission and feature basis through the App Review process.

日本語: Advanced Access のみ permission 単位の審査が必要。

> [R6] Requirements
> Meta App Review – For apps that needs access to data that you do not own or manage
> Business Verification – is required for all apps making requests for Advanced Access

日本語: 「自分が所有・管理していないデータ」にアクセスするアプリは App Review が必要、Advanced Access には Business Verification が必要。

**結論（重要・原文の解釈）:**
- permission が要求される相手は **トークンを発行する側＝自分のアカウント**であり、business_discovery で参照される「他店」は permission の付与主体ではない（R1 の "Perform this request on the ... IG User who is making the query"）。
- したがって、自分（＝アプリにロールを持つ開発者本人）の IG プロフェッショナルアカウントのトークンだけで叩くなら R4 の1〜2行目「My app is only for a business I own or manage → Standard Access / App Review: Not required」に該当し、**Standard Access で使える**。
- ただし **他人（顧客）のアカウントにログインさせて使わせる SaaS 形態にした瞬間、R4 の Tech Provider 行に該当し Advanced Access＋App Review＋Business Verification が必要**になる。
- R6 の "For apps that needs access to data that you do not own or manage" が business_discovery の「他店データ参照」に及ぶかどうかを明示的に述べた文は、business_discovery のページにも App Review のページにも **見当たらない（記載なし）**。R4 の表は login type と「誰に使わせるか」だけで access level を決めており、参照先データの所有者では分岐していない。

---

## C. 対象アカウントの条件

> [R1] Allows you to get data about other Instagram **Business or Creator** IG Users.

日本語: 取得できるのは他の Instagram ビジネスアカウントまたはクリエイターアカウントのデータのみ。

> [R1] Returns data about another Instagram Business or Creator IG User.

日本語: 返るのはビジネス／クリエイターアカウントのデータ。

> [R2] You can use the Instagram API with Facebook Login to get basic metadata and metrics about other Instagram **professional accounts**.

日本語: 対象は他の Instagram プロフェッショナルアカウント（＝ビジネス／クリエイター）。

> [R1] **Limitations**
> Data about age-gated Instagram Business IG Users will not be returned.

> [R2] **Limitations**
> Data about age-gated Instagram professional accounts will not be returned.

日本語: 年齢制限（age-gated）が掛かっているプロフェッショナルアカウントのデータは返らない。

**→ 個人アカウント（personal account）が返らない旨を "personal" という語で明示した文は見当たらない（記載なし）が、対象が Business / Creator / professional に限定される旨は上記の通り繰り返し明記されている。**

---

## D. 返せるフィールド

> [R1] **Field Expansion**
> You can use field expansion get public fields on the targeted IG User. Refer to the IG User reference for a list of public fields.

日本語: field expansion で対象 IG User の **public フィールド**が取得できる。一覧は IG User リファレンス（R3）を参照。

R3 のフィールド表で `Public` と明記されているもの（＝business_discovery で取得可能なフィールド）:

> [R3] Fields
> Public fields can be returned by an edge using field expansion. Only a few fields will be available for accessing Page-backed Instagram accounts.
>
> - `alt_text` **Public** — Descriptive text for images, for accessibility.
> - `biography` **Public** — Profile bio text.
> - `followers_count` **Public** — Total number of Instagram users following the user.
> - `id` **Public** — App-scoped User ID. Available for Page-backed Instagram accounts.
> - `media_count` **Public** — Total number of IG Media published on your app user's account.
> - `username` **Public** — Your app user's Instagram profile username.
> - `website` **Public** — Your app user's website URL.

日本語: public フィールドは alt_text / biography / followers_count / id / media_count / username / website の7つ。これらが field expansion でエッジ越しに返せる。

Public が付いていない（＝business_discovery では取得できない）フィールド:

> [R3] `follows_count`, `has_profile_pic`, `is_published`, `legacy_instagram_user_id`, `name`, `profile_picture_url`, `collaborative_media_search`, `shopping_product_tag_eligibility`

日本語: フォロー数・プロフィール画像 URL・表示名などには Public 表記がない。

### 最重要 4 フィールドの判定

| フィールド | business_discovery で取得可能か | 根拠 |
|---|---|---|
| **website** | **YES** | R3 で `website` に `Public` 表記あり |
| **biography** | **YES** | R3 で `biography` に `Public` 表記あり |
| **followers_count** | **YES** | R3 の Public 表記＋R1/R2 のサンプルレスポンスで実際に返っている |
| **media_count** | **YES** | R3 の Public 表記＋R1/R2 のサンプルレスポンスで実際に返っている |

> [R1] Sample Request with Field Expansion
> `GET graph.facebook.com/17841405309211844?fields=business_discovery.username(bluebottle){followers_count,media_count}`
> Sample Response
> ```
> { "business_discovery": { "followers_count": 267788, "media_count": 1205, "id": "17841401441775531" }, "id": "17841405309211844" }
> ```

日本語: followers_count と media_count が実際に返るサンプル。

**注意:** `website` を business_discovery 経由で取得したサンプルリクエストは R1・R2 のいずれにも掲載されておらず（**サンプルは記載なし**）、判定は R3 の「Public フィールドは field expansion でエッジから返せる」という規定＋`website` の Public 表記の組み合わせによる。R3 には `website` 単体を IG User ノードに直接 GET するサンプルのみ掲載:

> [R3] cURL Example
> `curl -X GET 'https://graph.facebook.com/v26.0/17841405822304914?fields=biography%2Cid%2Cusername%2Cwebsite&access_token=EAACwX...'`
> ```
> { "biography": "Dino data crunching app", "id": "17841405822304914", "username": "metricsaurus", "website": "http://www.metricsaurus.com/" }
> ```

### media エッジ経由で取れるもの

> [R1] **Accessing Edges with Field Expansion**
> You can also use field expansion to access the `/media` edge on the targeted IG User and specify the fields and metrics that should be returned for each IG Media object. Refer to the Media node reference for a list of public fields.

日本語: 対象アカウントの /media エッジにも field expansion でアクセスでき、各 IG Media の public フィールド・指標を指定できる。

> [R2] `?fields=business_discovery.username(bluebottle){media{comments_count,like_count,view_count}}`
> ```
> { "business_discovery": { "media": { "data": [ { "comments_count": 50, "like_count": 5837, "view_count": 7757, "id": "17858843269216389" }, ... ] }, "id": "17841401441775531" }, ... }
> ```

日本語: media 配下では comments_count / like_count / view_count / id が返る実例。

> [R2] Please note that `view_count` includes both paid and organic metrics

日本語: view_count は広告分（paid）とオーガニックの両方を含む。

---

## E. media のページネーション

> [R1] **Pagination**
> The `/media` edge supports cursor-based pagination, so when accessing it via field expansion, the response will include `before` and `after` cursors if the response contains multiple pages of data. Unlike standard cursor-based pagination, however, the response **will not include `previous` or `next` fields**, so you will have to use the `before` and `after` cursors to construct previous and next query strings **manually** in order to page through the returned data set.

日本語: /media はカーソル型ページネーション対応で before / after カーソルは返るが、`previous` / `next` の完成 URL は返らないので、自分でクエリ文字列を組み立てて手動でページ送りする必要がある。

- `limit` パラメータの上限・デフォルト値についての記述: **記載なし**（R1・R2 のいずれにも `limit` の語が出てこない）
- 何件まで／何日前まで遡れるかの上限についての記述: **記載なし**

---

## F. レート制限

business_discovery のリファレンス（R1）とガイド（R2）自体にはレート制限の記述は **記載なし**。Instagram Platform Overview（R7）に以下がある。

> [R7] **Rate Limiting**
> All endpoints are subject to Instagram Business Use Case rate limiting **except for Business Discovery and Hashtag Search endpoints, which are subject to Platform Rate limiting.**

日本語: 他のエンドポイントは Instagram の Business Use Case（BUC）レート制限だが、**Business Discovery と Hashtag Search だけは Platform Rate Limit** が適用される。

> [R7] Calls within 24 hours = 4800 * Number of Impressions

日本語: これは BUC 側の式（business_discovery には適用されない）。

> [R7] **Notes**
> Business Discovery and Hashtag Search API are subject to Platform Rate Limits.

日本語: 念押しで再掲されている。

Platform Rate Limit の内容（R8）:

> [R8] **Platform Rate Limits**
> Platform Rate Limits are tracked on an individual application or user level, depending on the type of token used in the request.
>
> **Applications**
> Graph API requests made with an application access token are counted against that app's rate limit. An app's call count is the number of calls it can make during a rolling one hour window and is calculated as follows:
> `Calls within one hour = 200 * Number of Users`
> The Number of Users is based on the number of unique daily active users an app has.

日本語: アプリトークンの場合は「1時間あたり 200 × ユニークデイリーアクティブユーザー数」。

> [R8] **Users**
> Graph API requests made with a user access token are counted against that user's call count. A user's call count is the number of calls a user can make during a rolling one hour window. **Due to privacy concerns, we do not reveal actual call count values for users.**
> Note that a user's call count can be spread over multiple apps. For example, a user could make X calls through App1 and Y calls through App2. If X+Y exceeds the user's call count that user will be rate limited.

日本語: ユーザートークンで叩く場合は「そのユーザーの call count」に加算されるが、**具体的な上限値はプライバシー上非公開**。同一ユーザーの消費は複数アプリにまたがって合算される。

**→ business_discovery は User アクセストークンで叩くため、実効上限値は公開されていない（記載なし）。DAU 1（自分だけ）のアプリで 200/時 という単純計算が当てはまるとは明記されていない。**

---

## G. 制約・禁止事項（"cannot" / "not supported" / "will not return" 等）

> [R1] Creating — This operation is **not supported**.
> [R1] Updating — This operation is **not supported**.
> [R1] Deleting — This operation is **not supported**.

日本語: 作成・更新・削除は非対応。読み取り専用。

> [R1] Data about age-gated Instagram Business IG Users **will not be returned**.
> [R2] Data about age-gated Instagram professional accounts **will not be returned**.

日本語: 年齢制限付きアカウントのデータは返らない。

> [R2] Note that this **does not grant you permission to access media objects directly** — performing a GET on any returned IG Media **will fail due to insufficient permissions**.

日本語: business_discovery で media の id が返っても、その IG Media を直接 GET することはできない（権限不足で失敗する）。**必ず business_discovery のネスト経由で取る必要がある。**

> [R1][R2][R3] The `media_url` field **is omitted** for video media that contains copyrighted or licensed audio, including audio added from the Instagram audio library, or that has been flagged for a copyright violation. This applies to all video media, including media the app user owns. It is also omitted for reels whose owner has turned off reel downloads, on requests that read another user's media: **business discovery**, tags, mentions, hashtag search, and collaborative media. That condition is evaluated against the reel's owner, so it can apply to a reel the app user co-authored. All other fields are returned as normal.

日本語: 著作権のある音源を含む動画、および所有者がリールのダウンロードをオフにしているリールでは、business_discovery 経由の読み取りで `media_url` が省略される。他のフィールドは通常どおり返る。

> [R1] Available for the Instagram API with **Facebook Login**.

日本語: business_discovery は Facebook Login 版の Instagram API 専用（Instagram Login 版では使えない）。R4 より、アプリは Facebook Login か Instagram Login のどちらか一方しか使えない（"Your app can either use Facebook Login or Instagram Login but not both."）。

> [R3] Only a few fields will be available for accessing Page-backed Instagram accounts.

日本語: Page-backed Instagram アカウントに対しては一部のフィールドしか使えない。

**business_discovery に関して「記載が見当たらなかった」項目:**
- media の `limit` パラメータ／取得可能な最大件数・遡及期間 → 記載なし
- 1回のクエリで指定できる username の個数（複数一括指定の可否） → 記載なし
- キャッシュ有効期間・データの鮮度 → 記載なし
- business_discovery 専用のレート制限数値 → 記載なし（Platform Rate Limit に従うとだけ記載）
- access level（Standard/Advanced）を business_discovery 単体について述べた文 → 記載なし