# `restaurants.google_place_id` を必須にすべきか

検討日: 2026-08-13（同日改訂: 結論を反転）
関連: [#843](https://github.com/Ayato-kosaka/nanitabeyo/issues/843) / [#1276](https://github.com/Ayato-kosaka/nanitabeyo/issues/1276) / [#1261](https://github.com/Ayato-kosaka/nanitabeyo/issues/1261) / [#821](https://github.com/Ayato-kosaka/nanitabeyo/issues/821)

## 結論

**必須のまま（`NOT NULL` 維持）でよい。** 初版は「非必須にすべき」と結論したが、次の指摘を受けて反転した。

> Google Map に存在せず、オープンデータにだけ存在する店舗はほぼ無い。Google Map を基準に、オープンデータはその一部と考えるべき。

この前提は正しく、そして**「オープンデータ側の在庫を守る」ことは `NOT NULL` を外す理由にならない**。

1. 逆引きできなかった約40%は BigQuery の `restaurant_seed_catalog` に残る。PostgreSQL へ入らないだけで資産は失われない。回収手段は「スキーマを緩める」ではなく「無料の逆引きを改善して再実行する」である
2. 逆引きの成立は、同時に**座標の裏取り**になっている。必須化はコストではなく品質ゲートとして機能している
3. 初版の「必須にすると重複が増える」は**誤り**。Google 起点の同一性を採るなら、必須化はむしろ重複を防ぐ

ただし `NOT NULL` を外すべき状況は将来必ず来る。§5 にトリガーを定義した。`DROP NOT NULL` は即時に実行できるため、その時点で外せばよい。

---

## 1. 必須化のメリット

「必須化のメリットがわからない」への直接の回答。実測ベースで4つある。

### 1.1 座標の裏取りが同時に成立する（最大のメリット）

採用ルール `layered_strict_wide` はクエリC（店名 + 半辺75mの矩形 `locationRestriction`）を必須にしている。`locationRestriction` は矩形外を実際に切り落とすため、**逆引きの成立 = Google 側にも同名店がその座標の75m以内に存在する、が確認済み**という意味になる。

これが効く理由は、`searchNearbyRestaurants` / `searchNearbySavedRestaurants` が**緯度経度で店を出す**（`restaurants.repository.ts` の球面三角法フィルタ）ためである。座標が狂った行は「違う場所に店が出る」という形で UX を直接壊す。しかも座標精度は Overture の測定済みの弱点である。

既存DB突合の実測（1,031件 join）は中央値 5.9m / p90 30.9m / 最大 258.4m。**必須化は、この精度を全行に強制する仕組みになっている。**

### 1.2 閉店・幽霊店の一次フィルタになる

Overture の `operating_status` は **789,612行中 789,609行が null** で、営業中判定にまったく使えない。IFAS の廃業・期限情報は地域偏在が極端で全国には使えない。

つまり現状、「その店が今もあるか」の証拠は**逆引きが成立したこと以外に存在しない**。必須化はこの唯一の生存確認を投入条件にすることと等しい。

### 1.3 同一性キーが1本で済む

Google 起点の同一性を採るなら、POI 押下で作られる行と seed 由来の行が最初から同じキーを持つ。座標 + 名称の後付け突合を本番 API に実装する必要がなくなる。

### 1.4 Google 機能に分岐が要らない

deep link（`getGoogleMapsLink`）、将来の Place Details 取得、写真、オーナー確認。place_id が無い行のフォールバックを書かなくてよい。

## 2. 逆引きできなかった40%の正体

指摘は「座標がバグっているか廃業店のはず」。**半分は当たっているが、半分は違う。** 内訳（10,000件中3,943件）は次のとおり。

| 理由 | 件数 | 割合 | Google に存在するか |
|---|---:|---:|---|
| `no_candidate_in_box` | 2,242 | 22.4% | **不明**。座標ズレ・閉店に加え、表記差（「(株)」の有無、支店名の語順、英字表記）でも同じ結果になる |
| `missing_name_or_address` | 692 | 6.9% | **おそらく存在する**。Overture に住所も郵便番号も無くクエリBを組めなかった＝こちら側の入力不足 |
| `no_layer_satisfied` | 678 | 6.8% | **ほぼ存在する**。矩形内に候補はあった。A・B の合意が取れなかっただけ |
| `layer3_rejected_by_strict_policy` | 331 | 3.3% | **ほぼ存在する**。候補はあったが片側支持のみのため、精度優先で自分から棄却した |

下2つ（1,009件 = 10.1%）は**矩形内に候補が居た**、つまり Google 側にその店がある可能性が高い。`missing_name_or_address` も店の非存在ではなく Overture の欠損である。

表記差については実証がある。既存DB突合の目視確認で、同一店なのに `百万石うどんこのみ小中店` ⇔ `このみ百万石うどん 小中店`、`風来坊 近鉄四日市店` ⇔ `居酒屋 風来坊 四日市店` のような差が観測されている。この種の差は `no_candidate_in_box` を量産する。

**ただしこの事実は結論を変えない。** 回収対象が「実在するのに紐付かなかった約17%」だとしても、その回収手段は**正規化ルールを直して無料の逆引きを再実行すること**であって、place_id 無しで PostgreSQL へ入れることではない。逆引きは0円かつ再開可能（`cache/probe.sqlite`）なので、何度でも回せる。

## 3. 初版の訂正

### 3.1 「必須にすると重複が増える」は誤り

初版の主張は「place_id 無しの Overture 行が DB に存在できないため、POI 押下時に突合相手が居らず Google 由来の重複行が増える」だった。これは**「行が存在しないこと」を「重複」と呼んだ誤り**である。正しくはこうなる。

| | POI 押下時の挙動 | 重複 |
|---|---|---|
| **`NOT NULL` 維持** | 未確定の店は PG に無い → Place Details から1行作られる | **起きない**（1店1行） |
| **nullable** | place_id が NULL の Overture 行が既にある → 後付け突合に失敗すると Google 由来の行が別に作られる | **起きうる**（同一店2行） |

指摘のとおり、Google 起点の同一性を採るなら「POI 押下 → Place Details から作る」が正しい挙動であり、オープンデータは**後から紐付ける注釈**として使うのが筋である。この設計では **`NOT NULL` の方が重複に強い**。

### 3.2 「40%を捨てることになる」は誇張

`3_4_build_restaurant_catalog.py:82` の gate が落とすのは **BigQuery catalog → PostgreSQL の publish** だけである。seed 自体は `restaurant_seed_catalog` に全件残り、逆引き試行は `*_attempts` に残る。ルールを改善して再実行すれば、確定した分から publish される。**捨てているのではなく保留している。**

### 3.3 生き残る論点

初版の主張のうち指摘後も変わらないのは「place ID は失効・変更・統合する外部識別子である」の一点だけである。これは在庫カバレッジの話ではなく**表現可能な状態**の話なので、§4 / §5 へ切り出した。

## 4. 必須維持で残るデメリット

いずれも今すぐ困るものではない。

| 論点 | 内容 | 今困るか |
|---|---|---|
| place ID の失効 | 失効を検知しても NULL にできない。行を消すしかないが、`dishes` / `dish_media` / `reactions` / `restaurant_bids` が `restaurants.id` を参照しているため実質消せない | 失効検知が未実装なので**困らない** |
| place ID の統合 | Google が2つの place を統合すると、我々の2行が同じ place_id を要求する。`UNIQUE` がこれを禁じるため同期が刺さる | 同上 |
| オーナー登録 / UGC 登録 | Google 未収録の新規開店・移動販売を登録できない | オーナー登録が未実装なので**困らない** |
| 誤 place_id の焼き付き | `9_1:212` の `ON CONFLICT (google_place_id) DO NOTHING` が衝突行を無言で落とす（実測 0.06%、789k換算で約470件） | **困る**。ただし `NOT NULL` とは独立の問題 |

最後の1つだけは `NOT NULL` の維持とは無関係に手を打つ価値がある。

## 5. `NOT NULL` を外すトリガー

次のいずれかに着手する時点で `ALTER TABLE restaurants ALTER COLUMN google_place_id DROP NOT NULL;` を実行する。それまでは維持でよい。

1. **place ID の失効・統合のハンドリングを実装するとき**（`0000_open_data_poc/REPORT.md` §4 の `last_verified_at` 運用）
2. **オーナー登録 / ユーザーによる店舗登録を実装するとき**（Google 未収録の店を受け入れる必要が出る）
3. **Google 以外のプロバイダへ deep link するとき**（`restaurant_external_ids` への移行）

後戻りコストが非対称なので、この順序で困らない。`DROP NOT NULL` はカタログ更新のみで即時に完了する。逆に `SET NOT NULL` は全行スキャンと backfill を要する。**「後で外す」は安く「後で付ける」は高い**ため、迷ったら維持側に倒すのが正しい。

## 6. 必須維持の場合にやること

スキーマ変更は不要。運用として次を固定する。

1. `3_4_build_restaurant_catalog.py:82` の gate は**維持**する。`restaurants` は「Google が知っている店」の集合と定義し、パイプライン README に明記する
2. 未確定 seed は BigQuery に保留し、正規化ルールを改善するたびに `3_2` を再実行する（0円・再開可能）。特に表記差（「(株)」、支店名の語順、英字表記）の正規化は `no_candidate_in_box` 2,242件へ直接効く見込み
3. `9_1_sync_restaurants.py` の `ON CONFLICT (google_place_id) DO NOTHING` を**無言にしない**。衝突件数と対象 seed をログ・レポートへ出す（現状は約470件が黙って消える見積り）
4. tier B（1,693件、最大258.4m）を publish に含めるかは別途判断する。tier A（4,342件）は既存DB突合で全件250m以内であり、そのまま投入してよい

## 7. 残る論点

- `address_components` / `image_url` の `NOT NULL`: open data 由来行は空配列・空文字で埋めており制約が形骸化している。`google_place_id` とは別の話として整理が要る
- 全789,612件への展開（#1276 の残タスク）: 約88時間・0円。§6-2 の正規化改善を入れてから回すか、先に回して差分で回すか
---

# 付録A: `google_place_id` の登録経路と参照箇所（棚卸し）

## A-1. 登録（書き込み）経路

`restaurants` 行を作る関数は実質 **`dishes.repository.ts:49 createOrGetRestaurant`（`upsert where: { google_place_id }`）** と **`9_1_sync_restaurants.py` の生SQL** の2つだけである。前者を呼ぶ経路が2つあるため、書き込み経路は計3系統になる。

### (1) `POST /v1/restaurants` — ユーザーが Google の地点を選んだとき

| 段 | 実装 |
|---|---|
| 入口A: 地図の POI 押下 | `app-expo/app/[locale]/(tabs)/map.tsx:172` `event.nativeEvent.placeId` → `createAndOpenRestaurant` |
| 入口B: レビュー投稿の店選択で POI 押下 | `.../review/selectRestaurant.tsx:126` |
| 入口C: 店名オートコンプリートの候補選択 | `.../review/selectRestaurant.tsx:390` `prediction.place_id`（`locations.service.ts:522` `callPlacesAutocomplete` → `:529` `place_id`） |
| API | `restaurants.controller.ts` `POST /v1/restaurants` → `restaurants.service.ts:375-` `createRestaurant` |
| 既存チェック | `:378` `findRestaurantByGooglePlaceId` |
| Google 呼び出し | `:110` `callPlaceDetails`（言語判定 `addressComponents,types`）→ `:177` `callPlaceDetails`（`id,displayName,location,addressComponents,plusCode,photos`）→ **課金SKU** |
| 書き込み | `:255` `google_place_id: googlePlaceId` → `:274` `createOrGetRestaurant` |

**この経路の place_id は Google 由来で 100% 確定**（#1261 Step 3 の「需要駆動」に相当）。

### (2) `POST /v1/dishes/bulk-import` — DB に結果が無いときの Google 補完

| 段 | 実装 |
|---|---|
| 入口 | `app-expo/lib/dishMediaSearch.ts:78-` `dish-media/search` が0件のときだけ実行 |
| Google 呼び出し | `dishes.service.ts:148` `locationsService.searchRestaurants` → Text Search |
| place_id 取得 | `dishes.service.ts:195` `places[].id` / `:459` `google_place_id: place.id!` |
| 実際のDB書き込み | Cloud Tasks 経由の非同期ジョブ `internal/dishes/create-dish-media-entry.service.ts:259` `createOrGetRestaurant(tx, ..., payload.restaurants.google_place_id)` |

### (3) 店提案パイプライン `9_1_sync_restaurants.py`（BigQuery catalog → PostgreSQL）

| 段 | 実装 |
|---|---|
| 既存PG値の引き継ぎ | `3_1_seed_existing_google_place_ids.py`（検索せず confidence 1.0 で移植） |
| 逆引き | `3_2_search_google_place_ids.py`（Text Search IDs Only を seed ごとに複数回、FieldMask は `places.id` 固定） |
| 採否判定 | `3_3_build_google_place_match_catalog.py` + `restaurant_google_place_match_overrides`（人手修正） |
| publish gate | `3_4_build_restaurant_catalog.py:82` `AND m.google_place_id IS NOT NULL` ← **確定できなかった約40%はここで落ちる** |
| 挿入 | `9_1:198-212` `INSERT ... ON CONFLICT (google_place_id) DO NOTHING` |
| 既存行の place_id 変更 | `9_1:169-176` `match_method = 'manual_override'` のときだけ UPDATE。`validate_staging`（`:130-160`）が暗黙変更と衝突を事前に止める |

補足: `1_2_import_existing_pg_restaurants.py:50` は逆方向（PG → BigQuery raw）の読み出しで、書き込みではない。

### 現状の含意

アプリからの登録経路 (1)(2) は**いずれも Google から place_id を受け取ることが起点**になっており、place_id 無しで `restaurants` 行を作る経路は存在しない。open data 由来の (3) だけが唯一の非 Google 経路だが、`3_4` の gate により結局 place_id 必須になっている。

## A-2. 参照（読み取り）箇所

### (a) 同一性キー / 重複排除 — NULL 化で最も影響を受ける

| 箇所 | 用途 |
|---|---|
| `dishes.repository.ts:57` `upsert where: { google_place_id }` | 全書き込みの冪等キー |
| `restaurants.repository.ts:296-300` `findRestaurantByGooglePlaceId` | `GET /v1/restaurants/by-google-place-id` と `POST /v1/restaurants` の既存判定 |
| `app-expo/lib/dishMediaSearch.ts:103` | DB 結果と Google import 結果のフロント側 dedupe |
| `9_1:120 / 212 / 233 / 252` | 同期の join key と `ON CONFLICT` |
| `8_1_validate_catalogs.py:209 / 214` | catalog の place_id 一意性検証 |

### (b) Google import の冪等性 — Google 由来経路のみ、NULL 化の影響なし

| 箇所 | 用途 |
|---|---|
| `dishes.repository.ts:147` `findReusableGoogleImportDishMediaByPlaceIdsAndCategory` | `place_id IN (...)` で再利用可能な media を探す |
| `dishes/deterministic-id.ts:70` `buildGoogleImportDishMediaId` | place_id + category_id から **UUID v5 で `dish_media.id` を導出**。`media_path` もここから決まる |

### (c) 外部リンク（UX）

| 箇所 | 用途 |
|---|---|
| `app-expo/lib/googlePlaces.ts:632` `getGoogleMapsLink` | `query_place_id=` で Google Maps を開く |
| 呼び出し元: `useDishMediaActions.ts:47`（地図ピン押下）、`SelectedRestaurantDetails.tsx:127` | |

### (d) ストレージのキー

| 箇所 | 用途 |
|---|---|
| `restaurants.service.ts:233` `storage.uploadFile({ identifier: googlePlaceId })` | 店舗画像の GCS パスに place_id が含まれる |

### (e) 表示・ログ・単なる列の受け渡し

- `DishMediaMap.tsx:376` marker の React key
- ログ payload: `map.tsx:159`、`selectRestaurant.tsx:113`、`SelectedRestaurantDetails.tsx:122/144`、`useDishMediaActions.ts:40/64`
- SELECT 列・型変換: `restaurants.repository.ts:81/126/175/215/234`、`shared/converters/convert_restaurants.ts:17/39`、各 DTO
- モック: `app-expo/data/searchMockData.ts`

### (f) 参照していないもの（重要）

- `dishes` / `dish_media` / `dish_reviews` / `reactions` / `restaurant_bids` の外部キーは**すべて `restaurants.id`（UUID）**であり、place_id には依存しない
- 共有リンク・sitemap（`scripts/gen-sitemap.mjs`、`scripts/verify-share-link-seo.mjs`）は place_id を使わない
- 画面遷移の URL は `restaurantId`（`selectRestaurant.tsx:395` 付近）

つまり **place_id は「同一性キー」として使われているだけで、「参照キー」としては使われていない**。この非対称性が、属性へ降格しても既存データが壊れない根拠である。
