# IG Media ノード フィールド一覧（Public 表記の確定）

- 調査日: 2026-08-27
- 入力 URL: `https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media`
  - → 本文空（実質 404 相当）。`/docs/instagram-platform/instagram-graph-api/reference/ig-media` へアクセスすると
    **`https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media` にリダイレクト**され、これが正本。
- ページ H1: `IG Media`

## Public の定義（原文）

> Fields
> Public fields can be read via field expansion.

Fields 表では、フィールド名の直後に `Public` バッジが付く形式（例: `alt_text Public`）。
Edges 表も同様（例: `children Public.`）。

## 判定表（依頼された11フィールド）

| フィールド | Public 表記 | 原文（該当行） |
|---|---|---|
| caption | **yes** | `caption Public` — "Caption. Excludes album children. The @ symbol is excluded, unless the app user can perform admin-equivalent tasks on the Facebook Page connected to the Instagram account used to create the caption. Available for Instagram API with Facebook Login only." |
| permalink | **yes** | `permalink Public` — "Permanent URL to the media." |
| media_type | **yes** | `media_type Public` — "Media type. Can be CAROUSEL_ALBUM, IMAGE, or VIDEO." |
| media_url | **yes** | `media_url Public` — "The URL for the media. The media_url field is omitted from responses in either of these cases: The video contains copyrighted or licensed audio … The reel owner has turned off downloads for the reel …" |
| timestamp | **yes** | `timestamp Public` — "ISO 8601-formatted creation date in UTC (default is UTC ±00:00)." |
| id | **yes** | `id Public` — "Media ID." |
| like_count | **no**（表に行はあるが Public バッジ無し） | `like_count` — "Count of likes on the media, including replies on comments. Excludes likes on album child media and likes on promoted posts created from the media. If queried indirectly through another endpoint or field expansion the like_count field is omitted if the media owner has hidden like counts." |
| comments_count | **yes** | `comments_count Public` — "Count of comments on the media. Excludes comments on album child media and the media's caption. Includes replies on comments." |
| children | **yes**（Fields 表ではなく **Edges 表**に記載） | `children Public.` — "Represents a collection of Instagram Media objects on an album Instagram Media." |
| username | **yes** | `username Public` — "Username of user who created the media." |
| thumbnail_url | **yes** | `thumbnail_url Public` — "Media thumbnail URL. Only available on VIDEO media." |

## Fields 表 全29行（バッジそのまま）

```
alt_text Public
boost_ads_list
boost_eligibility_info
caption Public
comments_count Public
copyright_check_information.status
id Public
is_ai_generated
is_comment_enabled
is_shared_to_feed Public
legacy_instagram_media_id
like_count
media_audio_type Public
media_product_type Public
media_type Public
media_url Public
owner Public
permalink Public
shortcode Public
thumbnail_url Public
timestamp Public
username Public
view_count Public
reposts_count Public
saved_count
shares_count
total_comments_count Public
total_like_count Public
total_views_count
```

※ `children` は Fields 表に記載なし。Edges 表（`children Public.` / `collaborators` / `comments` / `insights`）に記載。

## Edges 表 全4行

```
children Public.   Represents a collection of Instagram Media objects on an album Instagram Media.
collaborators      Represents a list of users who are added as collaborators on an Instagram Media object. Available for Instagram API with Facebook Login only.
comments           Represents a collection of Instagram Comments on an Instagram Media object.
insights           Represents social interaction metrics on an Instagram Media object.
```

## business_discovery に関する注記（原文抜粋）

ページ内で "Business Discovery" は6箇所。フィールド単位の可否に直結するもの:

1. reel のダウンロード設定（`media_url` の説明内）
   > "…only on endpoints that read other users' media, such as business discovery, tags, mentions, hashtag search, and collaborative media. The setting is evaluated against the reel's owner, so it can apply to a reel you co-authored."
2. `view_count` — "Available for Business Discovery API only."
3. `reposts_count Public` — "Number of times the media has been reposted. Available for FEED and REELS media. Not accessible through hashtag API endpoints."
4. `saved_count` — "Only accessible by the media owner or an accepted collaborator. Not accessible through Business Discovery, tagged/mentioned media, or hashtag…"
5. `shares_count` — "Not accessible through Business Discovery or hashtag API endpoints."
6. `total_views_count` — "Not accessible through Business Discovery or hashtag API endpoints. For Business Discovery, use view_count instead."

→ business_discovery 専用の「利用可能フィールド一覧」は本ページには存在しない。判定材料は Public バッジ＋上記の個別注記のみ。

## 設計上の注意（Tier A: caption 依存）

- `caption` は Public。ただし説明末尾に **"Available for Instagram API with Facebook Login only."** とある。
  business_discovery は Facebook Login 系エンドポイントなので前提と矛盾しないが、Instagram Login 単独では取れない。
- **carousel (`CAROUSEL_ALBUM`)**: `caption` は "Excludes album children"、`comments_count` も
  "Excludes comments on album child media"。つまり caption は親メディアにのみ存在し、
  `children` 経由で取れる子メディアには caption が無い。分類は必ず親の caption で行うこと。
- **reel**: `media_type` の値域は `CAROUSEL_ALBUM / IMAGE / VIDEO` のみで REELS は含まれない（reel は VIDEO 扱い）。
  reel を判別するには `media_product_type`（`AD/FEED/STORY/REELS`）が必要だが、こちらも
  "Available for Instagram API with Facebook Login only."。
  加えて reel の `media_url` は所有者がダウンロード不可設定にしていると business_discovery 経由で欠落しうる。
- `like_count` に Public バッジは無い。さらに "If queried indirectly through another endpoint or field expansion
  the like_count field is omitted if the media owner has hidden like counts." とあり、field expansion 経由では
  欠落しうる。エンゲージメント指標は `comments_count`(Public) を主、`like_count` は best-effort とするのが安全。
