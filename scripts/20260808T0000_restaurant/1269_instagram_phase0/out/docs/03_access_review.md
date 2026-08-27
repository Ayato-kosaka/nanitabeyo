# Instagram API 本番運用に必要な審査の切り分け（一次資料・逐語引用）

- 調査日: 2026-08-27
- 出典: すべて developers.facebook.com（Meta 公式ドキュメント）。ログインなしで閲覧可。

| # | URL | 状態 |
|---|-----|------|
| 1 | https://developers.facebook.com/docs/graph-api/overview/access-levels | 取得成功 |
| 2 | https://developers.facebook.com/docs/development/release/business-verification | 取得成功（`/documentation/...` にリダイレクト、Updated: Jul 7, 2023） |
| 3 | https://developers.facebook.com/docs/features-reference/instagram-public-content-access | 取得成功 |
| 4 | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search | 取得成功（Updated: Jul 23, 2024） |
| 補 | https://developers.facebook.com/docs/development/release/access-verification | 取得成功（Updated: Dec 12, 2024） |
| 補 | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent-media | 取得成功（Updated: Aug 17, 2026） |

---

## A. Standard Access の定義

> "There are two access levels: Standard and Advanced. Apps can request permissions with Advanced Access from any app user, and features with Advanced Access are active for all app users. **Permissions with Standard Access, however, can only be requested from app users who have a role on the requesting app, and features with Standard Access are only active for app users who have a role on the app.**"

Standard Access は「そのアプリに role を持つユーザー」のデータにしか及ばない。

> "**Standard Access permissions can only be requested from app users who have a role on the requesting app.** Similarly, features with Standard Access are only active for app users who have a role on the app."
> （原文: "Permissions with Standard Access can only be requested from app users who have a role on the requesting app. Similarly, features with Standard Access are only active for app users who have a role on the app."）

役割保有者以外には permission も feature も効かない。

> "**All Business, Consumer, and Gaming apps are automatically approved for Standard Access for all permissions and features.**"

Standard Access は申請不要で全 permission / feature に自動付与される。

> "**Standard Access is intended for apps that will only be used by people who have roles on them, or used during app development, when testing API endpoints that the calling app has not been approved for.**"

Standard Access は開発・自社内利用・未承認エンドポイントのテスト用という位置づけ。

> "**If your app will only be used by people who have a role on it, the permissions and features your app requires will only need Standard Access.** If your app will be used by people who do not have a role on it, the permissions and features that your app requires will need Advanced Access."

利用者が全員 role 保有者なら Standard のままでよい。外部ユーザーが1人でも入るなら Advanced が要る。

補足（この文書の適用範囲の注記）:

> "This document is only applicable to apps created using an App Type."

App Type ベースで作成したアプリ向けの記述（新しい Use Case ベースのアプリは別扱いの可能性あり）。

---

## B. Advanced Access が必要になる条件と、そのために必要なもの

> "**Permissions with Advanced Access can be requested from any app user, and features with Advanced Access are active for all app users. However, Business Verification is required to get Advanced Access. In some cases additional App Review on an individual permission and feature basis might be required.**"

Advanced Access は「全ユーザーに対して有効」。取得には **Business Verification が必須**、加えて permission / feature 単位の App Review が必要な場合がある。

> "**Advanced Access, however, must be approved on an individual permission and feature basis through the App Review process.**"

Advanced Access は permission / feature ごとに App Review を通す必要がある。

> "**Advanced Access now requires Business Verification** — As of February 1, 2023 apps requesting advanced access for permissions may have to be connected to a verified business."

2023-02-01 以降、Advanced Access 申請アプリは verified business への接続が必要。

年次の追加義務:

> "**Apps that have Advanced Access for a permission or feature must complete Data Use Checkup**, which is an annual process to certify that the app accesses Facebook APIs, products, and data in compliance with our Platform Terms and Developer Policies."

Advanced Access を持つと毎年 Data Use Checkup（年次のコンプライアンス確認）が必要。

アクセスレベル変更時の副作用:

> "**Restoring Advanced Access to permissions and features does not require re-review, but changing from Advanced to Standard will invalidate/deactivate any permission/feature for any app users who do not have a role on your app.**"

一度承認された Advanced は再取得に再審査不要。逆に Standard に戻すと非 role ユーザーの permission は即無効化される。

Consumer アプリの追加条件:

> "**consumer apps must be in Live mode before they can request permissions with Advanced Access from non-role app users**, and before features with Advanced Access will be active for non-role users."

Consumer アプリは Live モードでないと Advanced Access が効かない。

### B-2. Access Verification（Tech Provider 認定）— Advanced Access とは別枠の第3の審査

> "**Any business that has created or claimed an app that will be used by other businesses and requires any of the permissions listed below must be verified as a Tech Provider before other businesses can use the app.** Note that **access verification is independent of App Review and permission access levels.**"

他社ビジネスに使わせるアプリで対象 permission を使う場合、Tech Provider 認定が別途必要。App Review・アクセスレベルとは独立。

対象 permission リストに Instagram 系が含まれる（逐語）:
`instagram_basic`, `instagram_business_basic`, `instagram_business_content_publish`, `instagram_content_publish`, `instagram_creator_marketplace_discovery`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`, `business_management`, `ads_management` ほか。

> "**Business admins of an unverified Tech Provider business that claims a new app will receive an email notification about the access verification requirement whenever an app administrator requests Advanced Access for any of the permissions listed above.**"

Advanced Access を申請した時点で Access Verification の要求メールが飛ぶ。

> "Prerequisites — Before a business admin can begin the access verification process: **a business admin must complete Business Verification**; there must be **no restrictions on the business account**."

Access Verification の前提条件が Business Verification 完了。順序は Business Verification → Access Verification。

未通過時のエラー（逐語）:

> "Error code: 100 / Description: Unsupported get request. Object with ID <OBJECT_ID> does not exist, cannot be loaded due to missing permissions, or does not support this operation."

未認定だと汎用の code 100 エラーで弾かれる（原因が分かりにくい）。

---

## C. Business Verification が必要になる条件・必要書類・リードタイム

### 条件

> "**Business Verification is a process that allows us to gather information about you and your Business so we can verify your identity as a business entity.**"

事業体としての身元確認プロセス。

> "**Apps that request advanced access for permissions and apps that allow other Businesses to access their own data must be connected to a Business that has completed Business Verification. Until then, app users from other Businesses will be unable to grant these apps permissions and all features will be inactive.**"

(1) Advanced Access を申請するアプリ、(2) 他社ビジネスに自社データを触らせるアプリ、は Business Verification 済みの Business への接続が必須。未完了だと他社ユーザーは permission を付与できず feature も全て無効。

> "**If your app will only be used by app users who have a role on the app itself you do not need to complete verification; these users can grant your app any permissions at any time and all features are always active.**"

**role 保有者だけで使う限り Business Verification は不要**。その場合は任意の permission をいつでも付与でき、feature も常時有効。

> "As of February 1, 2023, **if your app requires advanced level access to permissions, you might need to complete Business Verification.**"

2023-02-01 以降、Advanced Access 要求 = Business Verification が必要になり得る。

### 手続き

> "**You can use the App Dashboard to connect your app to a Business that you're an Admin of, regardless of whether or not the Business has been verified, but the verification process itself must be completed in the Facebook Business Manager.** If you do not have a Business, you will be given the option to create one."

アプリと Business の接続は App Dashboard、検証本体は Business Manager 側で実施。

> "**Note that anyone with an Administrator role on your app can connect it to a Business, but only someone with an Admin role in the Business will be able to complete the verification process.**"

接続はアプリ管理者でも可、検証完了は Business の Admin のみ。

> "Step 1: Connect your app to a Business — **Load your app in the App Dashboard and go to Settings > Basic > Verification and click the Start Verification button** or the + Business Verification link if you have previously completed Individual Verification."

導線は App Dashboard > Settings > Basic > Verification。

### 必要書類

> "**Refer to our Business Manager Help Center's About Business Verification topic for an explanation of the process and a list of documents you will need.**"

**開発者ドキュメント本体には必要書類の列挙はなし**（Business Manager ヘルプセンターの "About Business Verification" に外出し）。→ **必要書類: 本調査範囲の一次資料には記載なし**。

### リードタイム

Business Verification 自体の所要日数は business-verification ドキュメントに **記載なし**。
関連して Access Verification（Tech Provider）は明記あり:

> "**Once a business admin has completed the process a decision will be made within approximately 5 days.**"

Access Verification は完了後およそ5日で判定。

既存アプリの猶予期間:

> "Once the email has been sent, **business admins will have 60 days to complete the verification process.** If the process is not completed within 60 days, all calls to endpoints that require any of the permission above will gradually be subjected to verification checks."

通知メール後60日以内に完了しないと段階的に検証チェックが適用される。

---

## D. Instagram Public Content Access（IPCA）の要件と可能になること

> "**Requires App Review.**"

App Review 必須。

> "**The Instagram Public Content Access feature allows your app to access Instagram Graph API's Hashtag Search endpoints.** The allowed usages for this feature is to discover content associated with your hashtag campaigns, understand public sentiment around your brand or identify contest, competition and sweepstakes entrants."

IPCA はハッシュタグ検索系エンドポイントへのアクセスを解放する feature。用途はキャンペーン発見・ブランド世論把握・応募者特定など。

> "Common Endpoints — **/ig-hashtag-search, /ig-hashtag, /ig-hashtag/recent-media, /ig-hashtag/top-media**"

対象4エンドポイント。

> "**This permission or feature requires successful completion of the App Review process before your app can access live data.**"

App Review を通さないと live データにアクセスできない。

> "**This permission or feature is only available with business verification. You may also need to sign additional contracts before your app can access data.**"

**IPCA は business verification がないと利用不可**。加えて追加契約の締結が必要な場合がある。

Allowed Usage（逐語、5項目）:

> "Discover content associated with its current campaign. / Provide customer support. / Identify entrants to its contests, competitions, or sweepstakes. / Understand public sentiment around brand. / Understand and manage their audience, develop their content strategy and obtain digital rights."

App Review の申請理由はこの5つの許可用途に沿う必要がある。

---

## E. ハッシュタグ検索（/ig_hashtag_search）の permission / access level / 制限

> "**This root edge allows you to get IG Hashtag IDs.** Available for the Instagram API with Facebook Login."

ハッシュタグ ID を取得するルートエッジ。**Instagram API with Facebook Login（=FB ログイン連携型）でのみ利用可**。

### Requirements（逐語）

> "**Features: Instagram Public Content Access**"

feature として IPCA が必要 → 実質 App Review + Business Verification。

> "**Permissions: instagram_basic** — If the token is from a User whose Page role was granted via the Business Manager, one of the following permissions is also required: **ads_management, business_management, or pages_read_engagement.**"

必須は `instagram_basic`。Business Manager 経由で Page 権限を得たユーザーのトークンなら上記3つのいずれかも追加で必要。

> "**Tokens: A User access token of a Facebook User who has been approved for tasks on the connected Facebook Page.**"

接続先 Facebook ページのタスク権限を持つ FB ユーザーのユーザーアクセストークンが必要（IG のみのログインでは不可）。

### エンドポイント仕様

> "GET /ig_hashtag_search?user_id=<USER_ID>&q=<QUERY_STRING>"
> "<USER_ID> (required) — The ID of the IG User performing the request. / <QUERY_STRING> (required) — The hashtag name to query."

リクエストには実行主体の IG User ID が必須。

> "**IDs are both static and global (i.e, the ID for #bluebottle will always be 17843857450040591 for all apps and all app users).**"

ハッシュタグ ID はグローバル固定なのでキャッシュ可能。

### Limitations（/ig_hashtag_search 逐語）

> "**You can query a maximum of 30 unique hashtags within a 7 day period.**"

**7日間あたりユニーク30ハッシュタグまで**。

> "**The API will return a generic error for any queries that include hashtags that we have deemed sensitive or offensive.**"

センシティブ／不適切と判定されたハッシュタグは汎用エラーになる。

### 関連: /ig-hashtag/recent-media の Limitations（逐語）

> "Only returns public photos and videos."
> "**Only returns media objects published within 24 hours of query execution.**"
> "Will not return promoted/boosted/ads media."
> "Responses are paginated with a maximum limit of 50 results per page."
> "Responses will not always be in chronological order."
> "**You can query a maximum of 30 unique hashtags within a 7 day period. Requesting this edge counts as querying the hashtag, even when you already have its ID, so it can count a hashtag against that limit.**"
> "You cannot request the username field on returned media objects."

recent_media は **直近24時間**の公開写真・動画のみ、1ページ最大50件、時系列順は保証なし、username 取得不可。**ID を既に持っていても recent_media を叩くだけで 30/7日 の枠を消費する**点が重要。

recent_media 側の Requirements も同一:

> "Features: Instagram Public Content Access / Permissions: instagram_basic ... / Tokens: A User access token of a Facebook User who has been approved for tasks on the connected Facebook Page."

---

## まとめ（切り分け）

| やりたいこと | App Review | Business Verification | Access Verification (Tech Provider) |
|---|---|---|---|
| role 保有者（自社の開発者・テスター）のアカウントのみで動かす | 不要（Standard 自動承認） | **不要**（"you do not need to complete verification"） | 不要（role 保有者は検証チェックをバイパス） |
| 一般ユーザー／他社のアカウントに対して permission を要求 | **必要**（permission/feature 単位） | **必要**（Advanced Access の前提） | 対象 permission（instagram_basic 等）を使うなら **必要** |
| ハッシュタグ検索（/ig_hashtag_search, recent_media, top_media） | **必要**（IPCA feature） | **必要**（"only available with business verification"） | instagram_basic を使うため該当し得る |

- Standard Access のままできること: **role 保有者のアカウントに対してなら、全 permission・全 feature が申請なしで即使える**。開発・社内検証・自社アカウント運用はここで完結する。
- 逆に Standard の壁: 顧客のアカウントを1つでも繋ぐ瞬間に Advanced が要り、そこで Business Verification が連鎖的に必要になる。
- ハッシュタグ検索は「Standard で試す」ができない部類（IPCA が feature として business verification 必須と明記）。