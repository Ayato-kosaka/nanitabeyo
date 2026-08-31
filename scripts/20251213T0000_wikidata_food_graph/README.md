# Wikidata Food Graph Pipeline README

## 0. 目的と全体像

本ディレクトリは、**Wikidata 由来の料理・飲み物グラフ**を取得し、BigQuery 上で **グラフ展開・除外判定（blacklist）・準マスタ（catalog）化**を行い、さらに派生データ（variants / images / macro genre / LLM features / LLM copy 等）を生成したうえで、最終的に **PostgreSQL の Serving テーブルへ同期**するパイプラインである。

データフローは以下。

```
Wikidata (SPARQL/API)
  → BigQuery (Source of Truth: raw + graph + catalog + derived)
  → PostgreSQL (Serving: API参照用の整形済みテーブル)
```

BigQuery は「分析・生成の SoT（Single Source of Truth）」であり、PostgreSQL は「配信・参照の Serving」である。
そのため **“本番に反映される形”**を作るには、（1）BigQuery 側で必要なテーブルを生成し、（2）同期スクリプト `9_*` を通す、という二段構えになる。

---

## 1. エントリポイントと実行モデル

### 1.1 エントリポイント

- **全体オーケストレーター**: `main.py`
  - “初期ロードまでの一括実行” の簡易ルート（設定の可変性が他スクリプトと異なる点に注意。後述）

- **段階実行（手動の標準ルート）**
  - `1_1_create_tables.py`
  - `1_2_fetch_and_load_nodes.py`
  - `1_3_generate_paths_and_summary.py`

- **Serving 反映（BigQuery → PostgreSQL 同期）**
  - `9_1_sync_dish_categories.py`
  - `9_2_sync_dish_category_features.py`
  - `9_3_sync_dish_category_localized_text.py`
  - `9_4_sync_dish_category_variants.py`
  - `9_5_remap_dish_categories_to_searchable.py`（随伴データ補正。#1748）

### 1.2 サブディレクトリの位置づけ

`548_*`, `550_*`, `557_*`, `572_*`, `575_*`, `581_*`, `582_*` はいずれも **目的別（LLM / 分析）パイプライン**であり、基本的に手動実行を前提とする。
共通して「BigQuery の catalog を入力に取り、結果を BigQuery の append-only / catalog 採用版テーブルへ反映」する。

---

## 2. ディレクトリ構造（責務ごとの層）

本ディレクトリの構造は、概ね以下の層に分かれる。

### 2.1 基盤（DDL / テーブル定義）

- `1_1_create_tables.py`
  - `infra/big-query/migration/*.sql` を実行し、BigQuery 側の基盤テーブル群を作成する
  - 例: `20251213T0000_create_wikidata_food_tables.sql`, `20251215T0000_create_wikidata_food_llm_labels.sql`, `20260715T0000_create_dish_category_label_alias_overrides.sql` 等

### 2.2 Core Extraction（Wikidata 取得 → raw / edges）

- `1_2_fetch_and_load_nodes.py`
  - Wikidata から node を取得し `food_nodes_raw` を更新
  - edge をローカル一時ファイル（`/tmp/.../edges.json`）に落として後続へ渡す

### 2.3 Graph（祖先展開・root集約・blacklist）

- `1_3_generate_paths_and_summary.py`
  - edges.json + roots + ancestor blacklist を入力に、`food_paths` / `dish_root_summary` / `dish_blacklist` を生成

### 2.4 Catalog（準マスタ）

- `3_1_build_dish_category_catalog.py`
  - blacklist 除外済みの `dish_category_catalog` を構築（CREATE OR REPLACE）

- `3_2_refresh_dish_category_catalog_core.py`
  - labels/aliases/descriptions/sitelinks/origin/cuisine/image 等 “core属性” を更新（MERGE）

- `3_3_refresh_dish_category_catalog_graph.py`
  - tags/roots 等 “graph由来属性” を更新（MERGE）

- `3_4_apply_label_alias_overrides.py`
  - `dish_category_label_alias_overrides` の手動補正を `dish_category_catalog` に反映（MERGE）
  - `3_2` は Wikidata 生値を再取得するため、Nanitabeyo 運用上の代表 label / alias は `3_4` で後から再適用する

### 2.5 Derived（variants / images / macro genre）

- `4_1_generate_variants.py` → `dish_category_variant_catalog`
- `4_2_process_images.py` → `dish_category_images`
- `550_macro_genre/*` → `dish_macro_genre_analysis` 等

### 2.6 LLM（labels / features / copy）

- `wikidata_food_llm_labels`（append-only ログ）
- `wikidata_food_llm_feature_scores`（append-only ログ）
- `wikidata_food_copy_generations`（append-only ログ）
- 採用版:
  - `dish_category_features_catalog`（MERGEで採用版更新）
  - `dish_category_localized_text_catalog`（MERGEで採用版更新）

### 2.7 Serving 反映（PostgreSQL）

- `9_*` が BigQuery の各 catalog を読み、PostgreSQL の Serving テーブルへ同期する

---

## 3. BigQuery テーブル群（役割別マップ）

### 3.1 Raw / Graph

- `food_roots`
  - 取得対象の root クラス定義（MERGEで冪等投入）

- `food_nodes_raw`
  - Wikidata から取得した node の原情報（label/desc 等）

- `food_edges_raw`（macro_genre 用に登場）
  - child→parent のエッジ原票（P31/P279 を区別しない前提）

- `food_paths`
  - child の全 ancestor を depth 付きで保持（グラフ展開の基礎）

- `dish_root_summary`
  - dish がどの root にぶら下がるか（複数root対応、min_depth保持）

### 3.2 Filtering

- `dish_ancestor_blacklist`
  - “この ancestor を持つものは除外” の人手運用テーブル

- `dish_blacklist`
  - 実際に “除外対象 dish” を保持
  - reason: ancestor / manual / quality / temporary 等

> 補足: LLM ラベリング（#548 等）が追加されると blacklist 精度が上がる。
> ただし LLM の生ログは `wikidata_food_llm_labels` に append され、最終的な blacklist 反映は別ステップとして整理される（どのラベルを採用するかの方針が運用上重要）。

### 3.3 Catalog（準マスタ）

- `dish_category_catalog`
  - blacklist 除外済みの “採用候補 dish カタログ”
  - label/desc/image/tags に加え、全言語JSONや origin/cuisine/roots 等も保持

### 3.4 Derived

- `dish_category_variant_catalog`
  - 表記揺れ（variants）

- `dish_category_images`
  - dish に紐づく画像候補（manual > analysis > wikimedia > partner などの優先を想定）

- `macro_genre_whitelist` / `dish_macro_genre_analysis`
  - macro_genre の手動採用QIDと、その割当分析結果

### 3.5 LLM（ログと採用版）

- append-only ログ（run_id 単位で追跡）
  - `wikidata_food_llm_labels`
  - `wikidata_food_llm_feature_scores`
  - `wikidata_food_copy_generations`

- 採用版（常に “最新採用状態” を保持）
  - `dish_category_features_catalog`
  - `dish_category_localized_text_catalog`

---

## 4. スクリプト依存関係（入力→出力→次に必要なもの）

ここが理解の核になるため、**スクリプトを “生成物” 起点で整理**する。

### 4.1 Core Extraction / Graph

#### `1_1_create_tables.py`

- **入力**: migration SQL（`infra/big-query/migration/*.sql`）
- **出力**: BigQuery 基盤テーブル（raw/graph/catalog/LLMログ/派生）
- **次に必要**: 初回実行またはスキーマ更新時に必須

#### `1_2_fetch_and_load_nodes.py`

- **入力**: Wikidata（root QID を起点）
- **出力**
  - BigQuery: `food_nodes_raw`（全入替）
  - ローカル: `/tmp/wikidata_food_graph/edges.json`

- **次に必要**: `1_3_generate_paths_and_summary.py` は edges.json を前提にする

#### `1_3_generate_paths_and_summary.py`

- **入力**
  - `/tmp/wikidata_food_graph/edges.json`
  - BigQuery: `food_roots`, `dish_ancestor_blacklist`

- **出力**
  - `food_paths`（再計算）
  - `dish_root_summary`（再計算）
  - `dish_blacklist`（祖先 blacklist 等を反映して生成）

- **次に必要**: catalog 生成（`3_1`）は `dish_blacklist` に依存する

---

### 4.2 Catalog

#### `3_1_build_dish_category_catalog.py`

- **入力**: `food_nodes_raw`, `food_paths`, `dish_blacklist`
- **出力**: `dish_category_catalog`（CREATE OR REPLACE）
- **依存の意味**: blacklist が変わると catalog の集合が変わるため、基本的に blacklist 更新後は `3_1` を再実行する

#### `3_2_refresh_dish_category_catalog_core.py`

- **入力**: `dish_category_catalog`（候補集合）, Wikidata（core情報）
- **出力**: `dish_category_catalog`（MERGE / 不要 item 削除を伴う可能性）
- **依存の意味**
  - “候補集合に存在しない item を落とす” 挙動があるため、**候補集合（3_1）を最新化してから**走らせるのが安全
  - core属性（labels_json 等）を更新したい場合の主ルート

#### `3_3_refresh_dish_category_catalog_graph.py`

- **入力**: `food_paths`, `dish_root_summary`, `dish_category_catalog`
- **出力**: `dish_category_catalog`（MERGE: tags/roots 等を更新）
- **依存の意味**: graph（paths/root_summary）が更新された場合、catalog の graph属性も更新が必要

#### `3_4_apply_label_alias_overrides.py`

- **入力**: `dish_category_label_alias_overrides`, `dish_category_catalog`
- **出力**: `dish_category_catalog`（MERGE: label_ja / label_en / labels_json / aliases_json を更新）
- **依存の意味**:
  - `3_2_refresh_dish_category_catalog_core.py` は Wikidata 生値で labels/aliases を上書きする
  - そのため、手動で採用した検索・表示向け label / alias は `3_2` の後に `3_4` で再適用する
  - `apply_to_label=true` の表記は `labels_json` に昇格するため、後続の `4_1_generate_variants.py` でも variants 生成元になる

反映ルール:

- `apply_to_label=true`
  - `surface_form` を対象 locale の代表 label に昇格する
  - `locale='ja'` なら `label_ja` と `labels_json['ja']` を更新する
  - `locale='en'` なら `label_en` と `labels_json['en']` を更新する
  - 上書き前の元 label は同 locale の `aliases_json` に降格して保持する
- `apply_to_label=false`
  - 代表 label は変えず、`surface_form` を同 locale の `aliases_json` に追加する
- 同一 `item_qid + locale` で `apply_to_label=true` が複数ある場合はエラー
- 新 label が既に alias に存在していても削除しない

---

### 4.3 Derived（variants / images / macro genre）

#### `4_1_generate_variants.py`

- **入力**: `dish_category_catalog`（label_en, labels_json 等）
- **出力**: `dish_category_variant_catalog`（DROP & CREATE / CREATE OR REPLACE 相当）
- **依存の意味**: label 更新（3_2 / 3_4）後は variants も作り直すのが自然
- **注意**: 現状は `aliases_json` を variants 生成に使わない。`apply_to_label=true` で `labels_json` に昇格した表記だけが variants に入る。

#### `4_2_process_images.py`

- **入力**: `dish_category_catalog.image_url`
- **出力**: `dish_category_images`（`source_type='wikimedia'` のみ staging 経由で差し替え。manual/analysis/partner は保持。反映後に staging は削除）
- **依存の意味**: image_url 更新（3_2）後、または画像正規化ロジック更新時に再実行する

#### `550_macro_genre/1_3_build_dish_macro_genre_analysis.py`

- **入力**: `dish_category_catalog`, `food_paths`, `macro_genre_whitelist`
- **出力**: `dish_macro_genre_analysis`（CREATE OR REPLACE）
- **依存の意味**
  - whitelist（手動運用）更新、または paths 更新時に再計算が必要
  - “曖昧候補” のレビューに使うため、生成タイミングと対象集合の整合が重要

---

### 4.4 LLM / Analysis Pipelines（共通パターン）

各ディレクトリは概ね共通して以下の構造を持つ（運用観点での重要ポイント）。

1. 入力集合を BigQuery から抽出（多くは `dish_category_catalog`）
2. OpenAI Batch API で推論
3. 結果を append-only ログへ格納（run_id を付与）
4. “採用版テーブル” へ反映（MERGE / 条件付き採用）
5. Serving 反映（9\_\*）は別途

#### 例: `557_region_gate/*`

- **入力**: `dish_category_catalog` + Batch API
- **出力**: `wikidata_food_llm_labels` → `dish_category_features_catalog`（feature_type=gate）
- **採用条件（例）**: allow & confidence='high' のみ自動採用など
- **Serving反映**: `9_2_sync_dish_category_features.py`

#### 例: `582_localized_text/*`

- **入力**: `dish_category_catalog` + Batch API
- **出力**: `wikidata_food_copy_generations` → `dish_category_localized_text_catalog`
- **Serving反映**: `9_3_sync_dish_category_localized_text.py`

> 重要: append-only ログの再実行は run_id 運用が前提。
> “採用版” の更新は MERGE なので、どの run を採用にするか（条件/選別ロジック）が実質的な仕様になる。

---

### 4.5 BigQuery → PostgreSQL Sync（Serving 反映の最終段）

#### `9_1_sync_dish_categories.py`

- **入力**: `dish_category_catalog`, `dish_macro_genre_analysis`, `dish_category_images`
- **出力**: PostgreSQL `dish_categories`（UPSERT + BQ にないもの削除）
- **注意**: 削除挙動（CASCADE 等）により停止し得る。BigQuery 側の候補集合を確定してから実行する。

#### `9_2_sync_dish_category_features.py`

- **入力**: `dish_category_features_catalog`
- **出力**: PostgreSQL `dish_category_features`（DELETE → INSERT 全件置換）

#### `9_3_sync_dish_category_localized_text.py`

- **入力**: `dish_category_localized_text_catalog`
- **出力**: PostgreSQL `dish_category_localized_text`（DELETE → INSERT 全件置換）

#### `9_4_sync_dish_category_variants.py`

- **入力**: `dish_category_variant_catalog`
- **出力**: PostgreSQL `dish_category_variants`（運用上は “BQ生成分のみ” を置換する設計意図）

#### `9_5_remap_dish_categories_to_searchable.py`

- **入力**: `dish_category_catalog` と `dish_category_features_catalog`（付け替え対の導出）
- **出力**: PostgreSQL `dishes.category_id`（同じ日本語ラベルの “検索に出る” カテゴリへ付け替え）
- **いつ要るか**: `4_1` の衝突解決が変わり、**既に保存済みの行だけが古い QID のまま**残るとき。
  変換表を直しても `dishes` の既存行は動かないので、この差を埋めないと
  「これから保存する分は出るが、前に保存した分は永久に出ない」状態になる（#1748）
- `--dry-run` で件数と UNIQUE (restaurant_id, category_id) の衝突を先に出せる。
  衝突する行は子（`dish_media` / `dish_reviews`）を既存 dish へ移してから空の dish を消す

---

## 5. 推奨実行シーケンス（依存関係の理由付き）

ここでは “目的” だけでなく、**なぜそれも必要になるか（依存関係）** をセットで示す。

### 5.1 取り込み対象（root / 対象領域）を増やした

**理由**: node集合が変わる → edges も変わる → paths/root_summary/blacklist/candidates 全部変わる

推奨:

1. `1_2_fetch_and_load_nodes.py`（node & edges 更新）
2. `1_3_generate_paths_and_summary.py`（paths/root/blacklist 再計算）
3. `3_1_build_dish_category_catalog.py`（候補集合再構築）
4. `3_2_refresh_dish_category_catalog_core.py`（core属性付与）
5. `3_3_refresh_dish_category_catalog_graph.py`（tags/roots 再計算）
6. `3_4_apply_label_alias_overrides.py`（手動 label / alias 補正を再適用）
7. 派生が必要なら:
   - `4_1_generate_variants.py`
   - `4_2_process_images.py`
   - `550_macro_genre/*`（運用している場合）

8. Serving 反映:
   - `9_1`, `9_4`（variants までやったなら）, features/copy も更新したなら `9_2`,`9_3`

### 5.2 画像を更新したい（Wikimedia 正規化の再生成）

**理由**: `dish_category_images` は `dish_category_catalog.image_url` を入力に作られるため、画像由来の変更は catalog core と images の依存関係に乗る

ケース別推奨:

- **image_url 自体が更新された（Wikidata側や core 更新で変わる）**
  1. `3_2_refresh_dish_category_catalog_core.py`（image_url 更新）
  2. `4_2_process_images.py`（正規化・候補化）
  3. `9_1_sync_dish_categories.py`（Serving反映）

- **正規化ロジックや source_type='wikimedia' の生成仕様が変わった**
  1. `4_2_process_images.py`
  2. `9_1_sync_dish_categories.py`

### 5.3 dish features を追加したい（新 feature_type を増やす）

**結論**: 追加先は `dish_category_features_catalog`。生成方法（LLM/ルール）は自由だが publish 方式に乗せる。

推奨手順（設計観点）:

1. feature の仕様決定
   - `feature_type` / `feature_key` / score の意味、対象集合、採用条件（confidence など）

2. 生成パイプライン追加（既存の `57x/58x` と同型にするのが安全）
   - 入力: 原則 `dish_category_catalog`（必要なら gate allow で絞る）
   - 出力（ログ）: `wikidata_food_llm_feature_scores` or `wikidata_food_llm_labels`（選択）

3. publish により採用版 `dish_category_features_catalog` を更新
   - MERGE で “採用版のみ” を維持する

4. Serving 反映
   - `9_2_sync_dish_category_features.py`

> 依存関係の要点:
> Serving は `dish_category_features_catalog` のみ見て同期するため、ログテーブルを増やしても “採用版へ publish” しない限り本番には乗らない。

### 5.4 variants を更新したい

**理由**: variants は `dish_category_catalog`（labels）依存。Wikidata refresh を伴う場合は `3_2` 後に `3_4` で手動補正を戻してから `4_1` を実行する。

推奨:

- Wikidata labels 更新を伴う: `3_2` → `3_4` → `4_1` → `9_1` → `9_4`
- 手動 label / alias 補正だけを反映する: `3_4` → `4_1` → `9_1` → `9_4`
- variants 仕様変更のみ: `4_1` → `9_4`
- **表記の勝者が入れ替わる仕様変更**: `4_1` → `9_4` → `9_5`
  （`9_5` を省くと、入れ替わる前の QID で保存済みの `dishes` が検索から到達不能なまま残る。#1748）

> 注意:
> 現状の `4_1_generate_variants.py` は `aliases_json` を読まない。
> `apply_to_label=true` で `labels_json` に昇格した表記は variants に入るが、
> alias 追加だけの表記は将来 `aliases_json` 由来 variants を実装するまで variants には入らない。

### 5.5 “本番に反映” だけしたい（BQ 側は出来ている）

**理由**: 同期スクリプトは BigQuery の生成物を読むだけなので、生成物が最新なら同期のみでよい

- categories: `9_1_sync_dish_categories.py`
- features: `9_2_sync_dish_category_features.py`
- localized text: `9_3_sync_dish_category_localized_text.py`
- variants: `9_4_sync_dish_category_variants.py`
- 既存 `dishes` の付け替え（表記の勝者が変わったときだけ）: `9_5_remap_dish_categories_to_searchable.py`

---

## 6. 再実行性（上書き/追記/冪等）と運用上の意味

### 6.1 BigQuery 側

- **CREATE TABLE IF NOT EXISTS / MERGE（冪等）**
  - `1_1_create_tables.py`（migration）
  - `food_roots` 初期投入は MERGE

- **TRUNCATE + INSERT（全入替）**
  - `1_2_fetch_and_load_nodes.py` → `food_nodes_raw`
  - `1_3_generate_paths_and_summary.py` → `food_paths` 等

- **CREATE OR REPLACE / DROP & CREATE（上書き生成）**
  - `3_1_build_dish_category_catalog.py`
  - `4_1_generate_variants.py`
  - `550_macro_genre/*` の analysis 生成

- **DELETE + INSERT（source_type 単位の部分更新）**
  - `4_2_process_images.py`（`dish_category_images` の `source_type='wikimedia'` のみ置換）

- **MERGE（更新 + 場合により削除を含む）**
  - `3_2_refresh_dish_category_catalog_core.py`（候補集合に無い item を落とす挙動があり得る）
  - `3_3_refresh_dish_category_catalog_graph.py`
  - features/localized_text の採用版も MERGE 更新

- **append-only（run_id運用前提）**
  - `wikidata_food_llm_labels`
  - `wikidata_food_llm_feature_scores`
  - `wikidata_food_copy_generations`

### 6.2 PostgreSQL 側

- `9_1`: UPSERT + BQ にないカテゴリは削除（CASCADE 等の影響を受ける）
- `9_2`: DELETE + INSERT（全件置換）
- `9_3`: DELETE + INSERT（全件置換）
- `9_4`: DELETE + INSERT（全件置換に近い／“BQ生成分のみ” の扱いは実装に従う）

---

## 7. 依存（外部サービス / 環境変数 / ディレクトリ外）

### 7.1 外部依存

- Wikidata SPARQL（node/core 取得）
- BigQuery（SoT）
- PostgreSQL（Serving）
- GCS（同期時のバックアップ）
- OpenAI API（LLM batch）

### 7.2 環境変数（主要）

- `GCP_PROJECT`, `BQ_DATASET`（`main.py` で可変）
- `DATABASE_URL`（PostgreSQL 同期）
- `OPENAI_API_KEY`（LLM）

> 注: “それ以外は固定値 `food-scroll.wikidata_food_graph`” といった挙動差があるため、運用時は `main.py` と段階実行ルートで設定の整合を取ること。

### 7.3 ディレクトリ外の依存

- BigQuery migration SQL: `infra/big-query/migration/*`
- Dataset 作成: `infra/big-query/20251213T0000_setup_wikidata_food_graph_dataset.sh`
- PostgreSQL schema/migration: `infra/supabase/migrations/*`

### 7.4 ローカル一時ファイル

- `/tmp/wikidata_food_graph/edges.json`（`1_2` → `1_3` の受け渡し）

---

## 8. 実行順序（完全版：何ができるかが追える形）

「どれを流すとどのテーブルができるか」を主語にした順序。

1. **基盤DDL**: `1_1_create_tables.py`
   → BigQuery 基盤テーブル一式が揃う（raw/graph/catalog/LLMログ/派生）

2. **Wikidata取り込み**: `1_2_fetch_and_load_nodes.py`
   → `food_nodes_raw` / `edges.json`

3. **グラフ展開 + blacklist**: `1_3_generate_paths_and_summary.py`
   → `food_paths` / `dish_root_summary` / `dish_blacklist`

4. **catalog 生成**: `3_1_build_dish_category_catalog.py`
   → `dish_category_catalog`（候補集合）

5. **catalog core 更新**: `3_2_refresh_dish_category_catalog_core.py`
   → `dish_category_catalog`（labels/aliases/descriptions/sitelinks/origin/cuisine/image 等が充実）

6. **catalog graph 更新**: `3_3_refresh_dish_category_catalog_graph.py`
   → `dish_category_catalog`（tags/roots 等が最新）

7. **catalog label / alias 補正**: `3_4_apply_label_alias_overrides.py`
   → `dish_category_catalog`（Nanitabeyo 運用上の代表 label / alias を再適用）

8. **派生（任意）**
   - `4_1_generate_variants.py` → `dish_category_variant_catalog`
   - `4_2_process_images.py` → `dish_category_images`
   - `550_macro_genre/*` → `dish_macro_genre_analysis`

9. **LLM（任意・目的別）**
   - `557_*` / `572_*` / `575_*` / `581_*` → `dish_category_features_catalog`
   - `582_*` → `dish_category_localized_text_catalog`
   - `548_*` → `dish_blacklist`（採用方針に従い反映）

9. **Serving 反映**
   - categories: `9_1`
   - features: `9_2`
   - localized text: `9_3`
   - variants: `9_4`

---

## 9. 補足：読み方（深く理解するための推奨順）

本READMEは運用に耐える「地図」だが、実装理解を深める際の読む順序も明示しておく。

1. `1_1_create_tables.py` が呼ぶ migration SQL（テーブル仕様の確定点）
2. `1_2_fetch_and_load_nodes.py`（Wikidata→raw+edges の定義）
3. `1_3_generate_paths_and_summary.py`（graph 展開と blacklist の要）
4. `3_1/3_2/3_3`（候補集合と属性付与の境界）
5. `4_1/4_2`（派生の具体例）
6. `9_*`（Servingの破壊的挙動＝削除/置換の理解が重要）
7. `57x/58x`（LLMのログ→採用版→同期の共通パターン）
