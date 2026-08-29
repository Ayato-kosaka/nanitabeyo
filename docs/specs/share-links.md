# 共有リンクとディープリンク

アプリ外から特定の画面へ入ってくる経路の仕様。`/s/:token`（共有リンク）、Universal Links / App Links、
`/store`（ストア誘導）を扱う。実装は `api/src/share/`、`app-expo/app/s/[token].tsx`、`app-expo/app/store.tsx`。

---

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

### 2. 開発環境は preview チャンネルではなく**専用サイト**

`serviceId` はリテラルしか書けないので、1 つのサイト定義で development と production を切り替えることはできない。**サイトを分ける**ことで解決している。

| Hosting サイト       | URL                              | `/s/**` の向き先  |
| -------------------- | -------------------------------- | ----------------- |
| `app-nanitabeyo-net` | `https://app.nanitabeyo.net`     | `api-production`  |
| `nanitabeyo-dev`     | `https://nanitabeyo-dev.web.app` | `api-development` |

preview チャンネルにしていないのは、**URL に hash が入り既定 7 日で失効する**ため。作り直すと hash が変わるので `WEB_BASE_URL` も API の `CORS_ORIGIN` も固定できない。専用サイトの live チャンネルなら URL は不変。

そのため `firebase-hosting-deploy.yml` は環境ごとにデプロイ先を `--only` で絞る。**絞らないと production ビルドが dev サイトにも載り、中身（本番 API 向け bundle）と rewrite の向き先（api-development）がちぐはぐになる。**

### 3. `og:image` に署名 URL を書いてはいけない

このアプリのメディア URL は**既定 24 時間で失効する**（`api/src/core/storage/storage.service.ts`）。署名 URL を snapshot として保存すると、SNS がキャッシュ期限後に再クロールしたときに 403 になり、**共有直後は画像が出るのに、しばらくすると消える**という壊れ方をする。

そのため

- DB には `preview_image_path`（**パス**）を保存する
- `og:image` には**不変の URL** `/s/:token/og-image` を入れる
- そのエンドポイントがアクセスのたびに署名し直して 302 する

`og:image` の URL が変わらないので、SNS 側のキャッシュを壊さずに中身だけ差し替えられる。

`preview_image_path` は 3 形式を許す（判定は `api/src/share/share-image.ts` の 1 箇所だけ）。

| 形                 | 例                                 | 由来                               |
| ------------------ | ---------------------------------- | ---------------------------------- |
| 絶対 URL           | `https://upload.wikimedia.org/...` | 友達投票の候補画像                 |
| Web の静的アセット | `/og/ja-JP.jpg`                    | 既定 OG 画像                       |
| GCS オブジェクト   | `production/dish_media/...jpg`     | 投稿のサムネイル（**署名が要る**） |

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

---

# Universal Links / App Links

対象ドメインは **`app.nanitabeyo.net`** の 1 つ。設定の正は次の 3 ファイルで、
どれか 1 つだけ変えると「リンクは開くがアプリが起動しない」壊れ方をする。

| 対象    | ファイル                                                                            | 内容                                                     |
| ------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| iOS     | `app-expo/public/apple-app-site-association`（+ `.well-known/` 配下の同名ファイル） | `appID`（Team ID + bundle ID）と受け取る `paths`         |
| iOS     | `app-expo/app.config.ts`                                                            | `associatedDomains: ["applinks:app.nanitabeyo.net"]`     |
| Android | `app-expo/public/.well-known/assetlinks.json`                                       | `package_name` と**リリース署名鍵の SHA-256 指紋**       |
| Android | `app-expo/app.config.ts`                                                            | `autoVerify: true` の intent filter（`pathPrefix: "/"`） |

- AASA / assetlinks は **`app-expo/public/` から静的配信される**（API 側では配信していない）。
  `public/` 直下と `public/.well-known/` の両方に AASA を置いてあるのは、iOS のバージョンで探しに行く場所が違うため
- Android の指紋は**リリース署名鍵のもの**。Play App Signing を使っている場合、
  ローカルビルドの debug 鍵とは一致しないので、実機検証は必ずリリース版で行う
- **`autoVerify: true` の intent filter へ他社のドメインを足さない。** App Links の検証は
  `https://<host>/.well-known/assetlinks.json` を Google が取りに行って成立するため、
  自分で配信できないドメインを書くと Play Console の Deep links が
  «Domain ownership not verified» を出し続ける（#1660: `*.supabase.co` が入っていた）。
  Android 11 以下は検証がアプリ単位なので、1 つ落ちると `app.nanitabeyo.net` まで巻き添えになる。
  固定は `app-expo/__tests__/appConfigAppLinks.test.ts`
- カスタムスキームは `nanitabeyo:`。Universal Link が効かない経路のフォールバックとして残している
- Supabase の OAuth はカスタムスキーム（`AuthSession.makeRedirectUri({ scheme: "nanitabeyo" })` +
  `WebBrowser.openAuthSessionAsync`）で戻るので、**Supabase のドメインを App Links に足す必要は無い**
- **アプリ側の受け口が別途必要。** `app/index.tsx` の `toInAppPath()` がロケール以外の先頭セグメントを捨てるため、
  新しいトップレベルパスを足すときはここに許可を追加する（`/s/` の項を参照）

# ストア誘導 `/store`

`{WEB_BASE_URL}/store` に来た人を、環境に応じて振り分けるスマートリンク（`app-expo/app/store.tsx`）。

| 環境                     | 挙動                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| アプリインストール済み   | Universal Link / App Link でアプリが開き、アプリ内では `/` へ即遷移     |
| モバイル・未インストール | アプリ起動を試み、**800ms 後**に App Store / Google Play へリダイレクト |
| デスクトップ             | `{WEB_BASE_URL}/` へリダイレクト                                        |

URL は `Env.WEB_BASE_URL` から組み立てる（ドメインをハードコードしない）。
ストアの URL は `EXPO_PUBLIC_APP_STORE_URL` / `EXPO_PUBLIC_PLAY_STORE_URL`。
