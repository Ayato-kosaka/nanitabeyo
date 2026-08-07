# 共有リンク `/s/:token`（#721）

投稿を SNS へ共有したときに、**投稿ごとのタイトル・サムネイルが共有カードに出る**ようにするための仕組み。

## なぜ必要か

Web は `output: "static"` なので、`/{locale}/posts?ids=...` の**初回 HTML** を `?ids=` に応じて変えられない。
クライアント JS が `<head>` を書き換えても、Facebook / X / LINE / Slack の共有クローラは**初回レスポンスの HTML しか見ない**ため、共有カードは常に既定の OGP になる。

全ページを SSR 化する必要はない。**動的 OGP が必要な共有 URL だけ** Cloud Run で HTML を作れば足りるので、Expo の static export はそのまま維持している。

User-Agent でクローラだけに別 HTML を返す Dynamic Rendering は採らない。人間にもクローラにも同じ `200 OK` を返す。

## 経路

```
https://app.nanitabeyo.net/s/<token>
        │
        ├─ アプリをインストール済み
        │     OS が Universal Link / App Link としてアプリを起動
        │     → app/s/[token].tsx → GET /v1/share-links/:token/resolve → 対象画面
        │
        └─ 未インストール / PC / SNS クローラ
              Firebase Hosting の rewrite
              → Cloud Run (api)
              → GET /s/:token が OGP 入りの HTML を 200 で返す
```

## 落とし穴（どれも一度踏むと気づきにくい）

### 1. `firebase.json` の rewrite は**順序が意味を持つ**

Hosting の rewrite は**先勝ち**。`/s/**` を catch-all（`"**" → /index.html`）より**前**に置かないと、`index.html` が 200 で返る。

#281 で `/sitemap.xml` が catch-all に落ちて index.html を 200 で返していたのと**まったく同じ形**の事故になる。404 ではなく 200 が返るので、監視でもテストでも気づきにくい。

### 2. `serviceId` はリテラルしか書けない

`firebase.json` は development / production で共通のファイルなので、preview チャンネルからも `api-production` を向く。

**開発環境で作った共有リンクを preview URL で開いても 404 になる。** dev の共有確認は development の API へ直接当てて行うこと。

### 3. `og:image` に署名 URL を書いてはいけない

このアプリのメディア URL は**既定 24 時間で失効する**（`api/src/core/storage/storage.service.ts`）。署名 URL を snapshot として保存すると、SNS がキャッシュ期限後に再クロールしたときに 403 になり、**共有直後は画像が出るのに、しばらくすると消える**という壊れ方をする。

そのため

- DB には `preview_image_path`（**パス**）を保存する
- `og:image` には**不変の URL** `/s/:token/og-image` を入れる
- そのエンドポイントがアクセスのたびに署名し直して 302 する

`og:image` の URL が変わらないので、SNS 側のキャッシュを壊さずに中身だけ差し替えられる。

`preview_image_path` は 3 形式を許す（判定は `api/src/share/share-image.ts` の 1 箇所だけ）。

| 形 | 例 | 由来 |
| --- | --- | --- |
| 絶対 URL | `https://upload.wikimedia.org/...` | 友達投票の候補画像 |
| Web の静的アセット | `/og/ja-JP.jpg` | 既定 OG 画像 |
| GCS オブジェクト | `production/dish_media/...jpg` | 投稿のサムネイル（**署名が要る**） |

### 4. `/s/:token` は Nest の慣習から 2 箇所だけ外れる

- `@Controller('s')` … `v1` を付けない。Firebase の rewrite が渡すパスと一致させる必要がある
- `@SkipResponseWrap()` … 付けないと `ResponseWrapInterceptor` が HTML を `{ success, data }` の JSON へ包み、**OGP が 1 つも読めなくなる**

`RobotsController`（#276）が同じ形の先例。

### 5. アプリ側は `/s/` を明示的に許可する必要がある

`app/index.tsx` の `toInAppPath()` は「先頭セグメントが BCP 47 のロケール」でないとディープリンクを**捨てる**。`s` は 1 文字なので `/^[a-zA-Z]{2,3}(-...)*$/` に一致せず、そのままだと**アプリを入れている端末で共有リンクが必ずホームへ落ちる**。

Universal Links は `/*`（`app-expo/public/.well-known/apple-app-site-association`）、App Links は `pathPrefix: "/"`（`app.config.ts`）なので、**リンクは確実にアプリへ来る**。受け側が落としているだけ、という気づきにくい壊れ方をする。

ここは #1027（ディープリンクの行き先を奪う）と #1135（OAuth の `code` を落とす）で二度事故っている関数なので、ロケール判定を緩めるのではなく `/s/` を**明示的に許可**する形にしてある。

### 6. 「アプリで開く」は OIA relay を経由する

iOS Safari / Chrome は「**同一サイト起点の Universal Link**」を抑止する。`app.nanitabeyo.net` の共有ページから同ドメインの `<a href>` を置いても**アプリが開かない**。

既存の `OpenInAppBanner`（`app-expo/components/deepLinking/`）と同じく、別オリジンの relay（`oia-relay.web.app`）を挟んで外部起点を作る。relay 側は `ALLOW_ORIGIN` を固定していて open redirect にはならない。

## 設計上の判断

### OGP は共有時の言語で固定する（多言語 snapshot にしない）

SNS は **URL 単位で OGP をキャッシュする**ため、同じ URL が閲覧者ごとに別の OGP を返す設計は成立しない（最初に踏んだ誰かの言語で固定されるだけ）。TikTok 等も同じ挙動。

`ja-JP` のユーザーが共有したリンクは、英語圏の人が見ても日本語のカードになる。これは仕様。

### `target_type` は「対象テーブル名」

このリポジトリの `target_type` は `reactions` / `contribution_tasks` / `prompt_usages` の 3 テーブルで既に使われており、値は一貫して**対象テーブル名**（`dish_reviews` / `dish_media` / `dish_categories`）。

そのため友達投票は `friend_vote` ではなく **`dish_category_group_vote_sessions`**。UI 上の呼び名を DB の識別子へ持ち込むと、どのテーブルを指すのかがコードからも DB からも読めなくなる。

値の集合は `shared/api/v1/constants/shareLinks.ts` と migration の `CHECK` 制約の**両方**にある。片方だけ増やすと API は 201 を返すのに INSERT が落ちる。

### 友達投票は既存の `share_token` を使う

友達投票は #856 の時点で `dish_category_group_vote_sessions.share_token` を持ち、`GET /v1/dish-category-group-votes/:shareToken` で解決できる。

共有トークンを 2 系統作らず、`/s/:token` は **OGP と入口の層に徹する**。`target_params.shareToken` に既存のトークンを持たせるだけなので、既存 URL・既存 API・既存 E2E を 1 つも壊さない。

### `share_link_items` は作らない

`token → 何を開くか` を解決するためのデータであって、多対多リレーション自体を業務データとして扱うものではない。`target_type + target_id + target_params(jsonb)` で足りる。

### token は `sha256` のみ。secret は混ぜない

共有リンクは SNS 上に長期間残るため、server secret でローテーションすると**過去のリンクが全滅する**。トークン自体が 128bit の CSPRNG なので、素の sha256 で総当たりも辞書攻撃も成立しない。

## 分かっている制約

- **revoke しても SNS のカードは消えない。** `s-maxage` は CDN の話で、SNS 側は独自にもっと長くキャッシュする。revoke で止まるのは**新規アクセス**だけ
- **`POST /v1/share-links` にレート制限が無い。** このリポジトリには現状 throttler が 1 つも入っていない。`preview_title` に店名・料理名が入るため、ID を総当たりして作成し放題だとコンテンツを吸い出せる。導入は別 Issue
