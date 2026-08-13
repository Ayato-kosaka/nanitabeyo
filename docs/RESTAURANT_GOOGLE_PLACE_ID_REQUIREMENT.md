# `restaurants.google_place_id` を必須にすべきか

検討日: 2026-08-13
関連: [#843](https://github.com/Ayato-kosaka/nanitabeyo/issues/843) / [#1276](https://github.com/Ayato-kosaka/nanitabeyo/issues/1276) / [#1261](https://github.com/Ayato-kosaka/nanitabeyo/issues/1261) / [#821](https://github.com/Ayato-kosaka/nanitabeyo/issues/821)

## 結論

**非必須にする（`NOT NULL` を外す）。** ただし「NULL を許す」だけでは重複と同期が壊れるため、以下を同時に満たすことが条件である。

1. `UNIQUE` は残す（PostgreSQL の `UNIQUE` は複数 NULL を許すため、部分ユニークとして機能する）
2. seed 由来行の重複防止は `restaurants_source_seed_id_uq`（既に存在）で担保する
3. `9_1_sync_restaurants.py` の join key を `google_place_id` から `source_seed_id` / `existing_restaurant_id` へ移す
4. クライアント・API の NULL 安全化（Google Maps deep link、bulk-import dedupe、型）

`google_place_id` は「店舗の同一性」ではなく「後付けの外部ID属性」へ降格させる。最終形は #843 §3 の `restaurant_external_ids` である。

---

## 1. 判断の前提となる実測値（#1276 PoC）

無料SKU（Text Search Essentials IDs Only）のみで Overture 店舗に `google_place_id` を逆引きした結果。

| 項目 | 実測値 |
|---|---:|
| 本番規模（10,000件）での確定率 | **60.47%** |
| 較正セット（1,000件）での確定率 | 63.60% |
| 採用ルール `layered_strict_wide` の誤マッチ率（負例300件） | 0.33% |
| tier A の誤マッチ率 | 0.00%（0/300） |
| 課金額 | 0円（GCP 請求コンソールで実額確認済み） |
| place_id 衝突（同一 place_id を複数 seed が取得） | 6/10,000 = 0.06%、200m以上離れた衝突は0件 |
| 既存 `restaurants` との突合（1,031件 join） | 距離 p50 5.9m / p90 30.9m / 最大 258.4m、km単位の誤マッチ0件 |

**確定できなかった約 39.5% の内訳（10,000件中）**

| 理由 | 件数 |
|---|---:|
| `no_candidate_in_box`（Overture の座標ズレ or 閉店） | 2,242 |
| `missing_name_or_address`（Overture に住所も郵便番号も無い） | 692 |
| `no_layer_satisfied`（矩形内に候補はあるが合意が取れない） | 678 |
| `layer3_rejected_by_strict_policy`（精度優先で棄却） | 331 |

読み方が重要である。**未確定の主因は「店が存在しない」ではなく「Overture 側の座標精度・住所欠損」と「精度を優先して自分から棄却した」**である。全789,612件に外挿すると、必須のままでは **約31万件の実在店舗が「Google が ID を確認してくれなかった」という理由だけで自社DBに存在できない**。

## 2. 必須にすることの意味

`google_place_id TEXT UNIQUE NOT NULL` は、DB制約として次を宣言している。

> Google が place ID を発行し、かつ我々がそれを無料で逆引きできた店だけが、自社の店舗マスターに存在してよい。

これは #843 の目的（Google Places を店舗マスターの仕入れ先にしない／`google_place_id` を後付けの external ID として扱う）と**正面から矛盾する**。#1276 の PoC は「後付け逆引きは無料で 60% までしか届かない」ことを数値で確定させた。必須を維持する場合、残り 40% の扱いは次の3択しかない。

| 選択肢 | 帰結 |
|---|---|
| (a) 40% を捨てる | seed が 78.9万→約47.7万に縮小。#843 の「現行DB保全 100%」ゲートとも整合しない |
| (b) 課金SKU（Text Search Pro / Place Details）で埋める | #821 の高額課金の再来。#1276 の制約「絶対に課金しない」を破る |
| (c) place_id なしの店を別テーブルへ隔離する | `dishes` / `dish_media` / `restaurant_bids` から参照できない二級市民テーブルが生まれる。nullable と同じ複雑さを、より悪い形で払う |

(a)(b)(c) いずれも、nullable 化のコスト（後述、実装数箇所）より高い。

## 3. 必須が引き起こす具体的な事故

### 3.1 誤った place_id が同一性に焼き付く

`UNIQUE NOT NULL` は「place_id = 店の同一性」を意味する。逆引き精度は tier A で 0/300、全体 0.33% と優秀だが 0 ではない。789,612件へ展開すれば tier B 側で誤りが数千件規模で残る。

さらに深刻なのは衝突時の挙動である。`9_1_sync_restaurants.py:212` は

```sql
ON CONFLICT (google_place_id) DO NOTHING
```

で、**衝突した行を黙って落とす**。PoC の衝突率 0.06% を 789,612件へ外挿すると約470件が無言で消える。nullable にして place_id を属性へ降格すれば、誤りは「リンクを外す」だけで回復でき、`restaurants.id`（bids / dishes / dish_media / reactions が参照する UUID）は一切動かさずに済む。

### 3.2 必須にすると、むしろ重複が増える（最大の逆説）

#843 §4 と #1261 Step 3 の需要駆動フローはこうである。

1. ユーザーが Google Map の POI を押す → place_id を 100% 確定で取得
2. 既存 restaurant を検索して見つかれば紐付け

必須のままだと、**まだ place_id が付いていない Overture 由来の店は DB に存在できない**。したがって手順2で突合する相手がそもそも居らず、`POST /v1/restaurants` が Google Place Details から新規行を作る。同じ店について「Overture 由来の行（存在できない）」と「Google 由来の行」が並ぶのではなく、Overture 側が丸ごと欠落したまま Google 由来行だけが増え続ける。40% の店については Google 依存が 100% のまま残る。

nullable にして初めて、「押された瞬間に既存の Overture 行へ後付けリンクする」＝ 無料の 60% を 100% へ育てる動線が成立する。

### 3.3 place ID は失効・変更する外部識別子である

`0000_open_data_poc/REPORT.md` §4 の運用方針は「place ID の変更・廃止に備え、失敗時に再検索し `last_verified_at` を更新する。core ID は変えない」である。この運用は **NULL 許容が前提**で、`NOT NULL` のままでは失効を検知しても行を維持できない（暫定的に空文字を入れる等の回避策は、`UNIQUE` と衝突して破綻する）。

## 4. 非必須にしたときに壊れるもの（実装コスト）

`google_place_id` / `googlePlaceId` の参照は TS だけで 109 箇所あるが、**値の存在を前提にしているのは以下だけ**である。大半は select して詰め替えるだけで、型を `string | null` にすれば通る。

| 箇所 | 影響 | 対応 |
|---|---|---|
| `app-expo/lib/googlePlaces.ts:632` `getGoogleMapsLink` | place_id で Google Maps を開く | NULL 時は `?api=1&query=<lat>,<lng>` + 店名にフォールバック。ピン精度がやや落ちるだけ |
| `app-expo/lib/dishMediaSearch.ts:103` | DB 結果と Google import 結果の dedupe | `google_place_id != null &&` を条件に追加（NULL 同士を同一視しない） |
| `api/src/v1/dishes/dishes.service.ts` `bulkImportFromGoogle` | Google 由来店の取り込み | **対応不要**。Google 由来の経路なので place_id は必ず存在する |
| `api/src/v1/dishes/dishes.repository.ts:147` `findReusableGoogleImportDishMediaByPlaceIdsAndCategory` | 同上 | **対応不要**（`in: placeIds` は NULL 行にヒットしない） |
| `api/src/v1/dishes/deterministic-id.ts` `buildGoogleImportDishMediaId` | place_id から UUID v5 を導出 | **対応不要**（Google import 専用） |
| `POST /v1/restaurants` / `GET /v1/restaurants/by-google-place-id` | place_id 起点の作成・取得 | **対応不要**（引数として place_id を受ける API） |
| `shared/converters/convert_restaurants.ts`、各 DTO / Response 型 | 型 | `string` → `string \| null` |
| `scripts/.../3_4_build_restaurant_catalog.py:82` `AND m.google_place_id IS NOT NULL` | publish gate | 撤去。place_id 無しでも公開する |
| `scripts/.../9_1_sync_restaurants.py` | join key・`ON CONFLICT` | `source_seed_id` / `existing_restaurant_id` ベースへ変更（後述） |

つまり**実質的な作り替えは deep link 1 箇所、dedupe 1 箇所、同期スクリプト、型**である。40% の在庫を捨てる／課金する／別テーブルを作る、のいずれよりも安い。

### 重複防止をどう担保するか

現在、`restaurants` の重複防止は `UNIQUE(google_place_id)` **だけ**に依存している。NULL を許すと NULL 行同士は衝突しないため、この一本足では seed 由来行の重複を止められない。ただし既に

```sql
CREATE UNIQUE INDEX restaurants_source_seed_id_uq
  ON restaurants(source_seed_id) WHERE source_seed_id IS NOT NULL;
```

が `20260812T0100_add_restaurant_recommendation_sync_metadata.sql` で入っている。**seed 側の同一性はこちらで担保済み**であり、これが nullable 化の技術的前提条件を既に満たしている。結果として重複防止は次の二本立てになる。

- `UNIQUE(google_place_id)`（NULL を除く部分ユニーク）: Google 側の同一性
- `UNIQUE(source_seed_id) WHERE NOT NULL`: open data seed 側の同一性

## 5. 推奨する段階的移行

### Step 0（9_1 の本番投入より前に必須）

```sql
ALTER TABLE restaurants ALTER COLUMN google_place_id DROP NOT NULL;
COMMENT ON COLUMN restaurants.google_place_id IS
  '後付けの外部ID。未確定・失効時はNULL。店舗の同一性はidが担う。';
```

`UNIQUE` はそのまま残す。順序が重要で、**先に seed を投入してから nullable 化することはできない**（3_4 の gate が 40% を捨てた状態で publish 済みになるため）。

### Step 1: NULL 安全化

上表の deep link / dedupe / 型を対応する。API レスポンスの `google_place_id` は `string | null` になる。

### Step 2: パイプライン側の join key 移行

- `3_4_build_restaurant_catalog.py`: `AND m.google_place_id IS NOT NULL` を撤去
- `9_1_sync_restaurants.py`: `ON CONFLICT (google_place_id)` と `WHERE r.google_place_id = s.google_place_id` を `source_seed_id` ベースへ変更。place_id は「一致したら更新する属性」として扱い、衝突時は同期を止めるのではなく **place_id だけ NULL のまま publish** する（`validate_staging` の既存 place_id 変更ガードは維持）

### Step 3: `restaurant_external_ids` への移行（#843 §3 / REPORT §4）

```sql
restaurant_external_ids (
  restaurant_id uuid not null,
  provider text not null,          -- google | overture | osm | ...
  external_id text not null,
  match_status text not null,
  match_method text,               -- poi_click | auto_match | manual | legacy_pg
  match_confidence numeric,
  matched_at timestamptz,
  last_verified_at timestamptz,
  primary key (provider, external_id)
);
```

`restaurants.google_place_id` は当面 `provider='google'` 行の denormalized cache として残し、既存の `by-google-place-id` 検索と bulk-import dedupe をそのまま動かす。移行完了後に列を落とすかは別判断でよい。

### Step 4: 投入ポリシー（PoC の tier をそのまま使う）

| tier | 件数 | 実測 | 扱い |
|---|---:|---|---|
| A | 4,342 | 負例誤マッチ 0/300、既存DB突合で全件250m以内 | `match_confidence` 高で自動リンク |
| B | 1,693 | 250m超3件、最大258.4m | 保存するが confidence を下げ、POI 押下 / owner claim で昇格 |
| 未確定 | 約40% | — | place_id NULL のまま**通常どおり公開する** |

未確定行は #1261 Step 3（POI 押下時の 100% 確定 place_id）で需要順に埋まっていく。よく使われる店から埋まるので、埋まる順序としても正しい。

## 6. 必須化を選ぶ場合の条件（対称的な整理）

以下がすべて成立するなら必須維持も合理的だが、現時点ではいずれも成立していない。

- [ ] 逆引き確定率が実用上 100% に近い → **実測 60.47%**。無料の範囲でこれ以上は誤マッチが跳ねる（`layered_wide` で確定率 +5.4pt に対し誤マッチ 0.33%→14.67%）
- [ ] place_id 無しの店に事業上の価値がない → 成立しない。SNS 由来の権利処理済み媒体（4_2）は place_id の有無と独立に紐付く。画像も #843 §6 で Google Photos を使わない方針
- [ ] place_id が安定した永続識別子である → 成立しない。変更・失効前提の運用が REPORT §4 に明記されている
- [ ] 課金してでも全件に付ける予算がある → #821 の経緯と #1276 の制約により成立しない

## 7. 残る論点

- **UX の劣化幅**: place_id が無い店で Google Maps を開いたときのピン精度。座標クエリでの実測を Step 1 で確認したい
- **`address_components` / `image_url` の必須制約**: REPORT §4 が指摘するとおり、これらも Place Details 前提の必須列である。`google_place_id` と同じ理由で見直し対象になる（open data 由来行は `address_components` を空配列、`image_url` を空文字で埋めており、実質的に制約が形骸化している）
- **列を残すか外部IDテーブルへ全面移行するか**: Step 3 完了時点で再判断する
