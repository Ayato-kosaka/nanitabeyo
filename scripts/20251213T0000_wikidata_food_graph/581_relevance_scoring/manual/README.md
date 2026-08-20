# manual correction runbook（#1383）

`dish_category_features_catalog`（BigQuery採用版）の一部の feature score が、
実運用でのレビュー（例: 「サクッと」で検索すると焼き鳥が出てくるのはおかしい）を経て
「個別に修正すべき」と判断された場合に、通常の LLM Phase1/Phase2 バッチを再実行せず、
人間がレビュー済みの値を安全に反映するための運用スクリプト群。

**このディレクトリは #581 の通常パイプライン（`1_1〜3_1`）とは別責務。**
LLM Batch API による大量採点と、人間による少数件の是正を混同しないために
`manual/` 配下に分離している。

## PostgreSQL を直接編集しない

`dish_category_features`（PostgreSQL serving）は
`9_2_sync_dish_category_features.py` 実行時に **全削除→全INSERT** される（全置換）。
そのため PostgreSQL を admin 操作や直接 SQL で編集する運用は採用しない。
manual correction は必ず

```
BigQuery: wikidata_food_llm_feature_scores (append)
  → BigQuery: dish_category_features_catalog (MERGE)
    → PostgreSQL: dish_category_features (9_2 で全置換)
```

の順で反映する。PostgreSQL 側だけを直して BigQuery 側を直さないと、
次に誰かが `9_2` を再実行した瞬間に修正が消える。

## 基本フロー

```text
1. 影響調査（本README末尾の「調査の仕方」を参照）
2. 仕様変更 / review decision を確定
   - 個別カテゴリだけが過大/過小 → rubric は維持し、値だけ補正（このrunbookの対象）
   - 判定基準自体が広すぎる → 先に rubric 側（例: 866_dining_pace/dining_pace_prompt.md）を
     更新し、「仕様と実データの不整合」を残さない
3. manual/1_insert_feature_scores.py --dry-run
4. manual/1_insert_feature_scores.py 実行（--dry-run を外す）
5. manual/2_merge_feature_scores.py --run-id <run_id> --dry-run
6. manual/2_merge_feature_scores.py --run-id <run_id> --apply
7. 9_2_sync_dish_category_features.py --schema dev --dry-run
8. 9_2_sync_dish_category_features.py --schema dev
9. API / recommendation の accuracy regression（下記「recommendationへの影響確認」）
10. before / after を記録し、Issue にレビュー結果・判断根拠を残す
11. 問題なければ production（`--schema public`）へ反映

このリポジトリでは、DB に影響する操作の実行記録を残すため、5〜8 は
ローカルではなく GitHub Actions（`.github/workflows/manual-feature-correction.yml`）
の workflow_dispatch から実行することを既定とする。3〜4（insert）も同じ workflow の
`insert` step から実行できる。理由は `db-migrate.yml` と同じで、「誰かのローカルから
流す」と、いつ・何を適用したかが記録に残らないため。
```

## `1_insert_feature_scores.py`

人間がレビュー済みの feature correction を、`run_id` 単位で
`wikidata_food_llm_feature_scores` に **append のみ** する。
`dish_category_features_catalog` には触れない。

```bash
python3 manual/1_insert_feature_scores.py \
  --run-id "20260820_manual_dining_pace_yakitori" \
  --item-qid Q483163 \
  --feature-type dining_pace \
  --feature-key quick \
  --score 0.5 \
  --confidence high \
  --reason "串を数本ずつ注文し飲みながら食べる居酒屋利用が代表像で、サクッと利用は限定的" \
  --dry-run
```

複数件は `--input-jsonl corrections.jsonl`（1行1件、以下のキーを持つJSON）でまとめて投入できる。
単一行入力とJSONL入力は同じ validation ロジックを通る。

```json
{"item_qid": "Q483163", "feature_type": "dining_pace", "feature_key": "quick", "score": 0.5, "confidence": "high", "reason": "..."}
```

保存される値は常に固定である。LLM run と監査上区別するため偽装しない。

```text
phase = manual
model = manual
task  = 既定 #1383_manual_relevance_scoring（--task で上書き可）
run_id = --run-id で指定した値
```

validation（すべて通らないと INSERT しない）:

- `run_id` / `item_qid` / `feature_type` / `feature_key` / `reason` が空でない
- `item_qid` が `Q\d+` 形式で、かつ `dish_category_catalog` に実在する
- `(feature_type, feature_key)` が既存 `dish_category_features_catalog` に存在する組み合わせであること
  （新規 feature を manual 経由で生やしたい場合のみ `--allow-new-feature-key` で明示的に許可する）
- `score` が `0 / 0.5 / 1` のいずれか
- `confidence` が `high / medium / low` のいずれか
- `reason` が 120 文字以内
- 同一 `(run_id, item_qid, feature_type, feature_key)` が `wikidata_food_llm_feature_scores` に未存在
- 同一入力バッチ内で `(item_qid, feature_type, feature_key)` が重複していない

`--dry-run` では before(catalogの現行値) / after(新値) / diff を件数ぶん表示する。
実行後は自動で postcheck（inserted rows / distinct items / distinct feature pairs /
duplicate keys=0 / run_id 再SELECT）を表示する。

## `2_merge_feature_scores.py`

指定 `run_id` の `wikidata_food_llm_feature_scores` を `dish_category_features_catalog` へ
差分 MERGE する。本体の SQL は `../sql/merge_feature_scores_by_run_id.sql`
（`sql/merge_phase2_features_catalog_20260718.sql` の汎用版。target_run_id や
expected count をSQLへハードコードしない）。

```bash
python3 manual/2_merge_feature_scores.py --run-id "20260820_manual_dining_pace_yakitori" --dry-run
python3 manual/2_merge_feature_scores.py --run-id "20260820_manual_dining_pace_yakitori" --apply
```

`--expected-row-count` / `--expected-item-count` を渡すと、mutation 前に一致確認する
（誤った `run_id` を渡す事故の防止。値は呼び出し側が都度指定し、SQL にはハードコードしない）。

precheck（`--dry-run` でも `--apply` でも実行し、落ちれば MERGE しない）:

- source run が 0 件でない
- 必須列が null / 空でない、score が `[0, 1]` の範囲内
- `(item_qid, feature_type, feature_key)` が run 内で重複していない
- catalog 外 QID が含まれていない
- （指定時）`--expected-row-count` / `--expected-item-count` と一致する

`--dry-run` は変更対象一覧（料理名 / QID / feature_type / feature_key / current / new / diff /
current run_id / source run_id）を表示するのみで MERGE は実行しない。
`--apply` は `sql/merge_feature_scores_by_run_id.sql` をそのまま実行する
（ASSERT に違反すれば例外になり MERGE 前で止まる）。実行後は postcheck
（run_id 別の feature_type/key 件数、catalog total rows/items、positive JP gate rows）を表示する。

## `phase=manual` の意味と優先順位

### 通常publish（`3_1_publish_features.py` / `sql/publish_features.sql`）との関係

`3_1_publish_features.py` は Phase2 > Phase1 の優先順位で `wikidata_food_llm_feature_scores`
から `dish_category_features_catalog` へ MERGE する（`phase='manual'` の行は選定対象に含めない。
`priority` の `ORDER BY CASE phase WHEN 'phase2' THEN 1 ELSE 2 END` は manual を phase1 と
同列の優先度最低として扱ってしまうため、通常publishの対象からは意図的に外れている）。

このリポジトリでは **案B: `run_id` 明示 MERGE を正とする** を採用する。

- manual correction は `manual/2_merge_feature_scores.py --run-id ...` の実行によってのみ
  採用版へ反映される。`3_1_publish_features.py` の自動選定ロジックには含めない。
- 理由: manual correction は「特定QID・特定featureに対する、人間が理由付きで判断した
  一時的/恒久的な上書き」であり、Phase1/Phase2 の全件再生成ロジックへ暗黙に混ぜると、
  次回 rubric 変更時にどれが manual 由来かの追跡が難しくなる（`note` に `phase=manual` は
  残るが、選定順位のロジックにまで manual を混ぜるとテストすべき組み合わせが増える）。

### generic publish（Phase1 全置換 / Phase2 差分再投入）を再実行した場合

`3_1_publish_features.py` や、`replace_features_catalog_from_run_20260718_phase1.sql` のような
全置換SQLを再実行すると、**manual correction は上書きされて消える**
（selection ロジックに manual を含めていないため）。

再実行する予定がある場合は、そのつど

```bash
python3 manual/2_merge_feature_scores.py --run-id <manual run_idの一覧> --apply
```

を Phase1/Phase2 再投入の**後**に再実行し、manual correction を再適用すること。
過去に投入した manual run_id は

```sql
SELECT DISTINCT run_id
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
WHERE phase = 'manual'
ORDER BY run_id
```

で一覧化できる。

### manual correction を解除する

rubric 側の修正が正式に Phase1/Phase2 へ統合され、manual correction が不要になった場合は、
`3_1_publish_features.py` の通常publishを再実行すればよい（manual は選定対象外のため、
Phase1/Phase2 の値で自動的に上書きされる）。個別に「manual だけを取り消してPhase1/2の値へ
戻したい」場合は、対象の `(item_qid, feature_type, feature_key)` に対して Phase1/Phase2 の
値を `run_id` を変えて `manual/1_insert_feature_scores.py` → `2_merge_feature_scores.py` で
再投入するのではなく、`3_1_publish_features.py` の対象範囲を絞って再実行するほうが
source of truth（LLM run由来）を歪めない。

### 「恒久override」と「一時的な即時反映」を混同しない

manual correction は原則、**仕様変更をLLMバッチで一括再生成する前に、
壊れている値だけを速やかに serving へ反映する手段**として扱う。
rubric 修正（例: `866_dining_pace/dining_pace_prompt.md` の更新）とセットで行い、
「仕様は直したがデータは直していない」「データは直したが仕様に反映していない」という
不整合を残さないこと。

## GitHub Actions（`manual-feature-correction.yml`）

`DATABASE_URL` や GCP サービスアカウント資格情報をローカル/対話セッションに置かない運用のため、
insert / merge / 9_2 sync dev は `.github/workflows/manual-feature-correction.yml` の
workflow_dispatch からも実行できる。inputs は各ステップに対応する:

```text
step: insert | merge | sync-dev
run_id: 対象run_id（insert/mergeで必須）
corrections_jsonl: insertで投入するJSONL本文（複数行貼り付け可）
dry_run: true/false（既定 true）
expected_row_count / expected_item_count: mergeの事故防止チェック（任意）
```

`dry_run: true` のまま実行して出力（Job Summary / ログ）を確認し、問題なければ
`dry_run: false` で再実行する。`step: sync-dev` は内部で
`9_2_sync_dish_category_features.py --schema dev` を呼ぶ（`--schema public` はこの
workflow からは実行できない。本番反映は別途 `db-migrate.yml` 相当の承認フローに従うこと）。

## rollback

### BigQuery catalog を戻す

`dish_category_features_catalog` は `run_id` 列を持つため、対象 run が MERGE で
UPDATE した行は「元の値・元の run_id」が失われる（MERGE は上書き）。戻す場合は、

1. 直前の Phase1 全置換 SQL（例: `replace_features_catalog_from_run_20260718_phase1.sql`
   のような、そのタスクの正になっている全置換SQL）を再実行して catalog を既知の
   良好な状態へ戻す、または
2. 戻したい値を新しい `run_id` で改めて `manual/1_insert_feature_scores.py` →
   `manual/2_merge_feature_scores.py` に投入する（「訂正の訂正」を新run_idで残す。
   このほうが「なぜ値が変わったか」の監査ログが連続する）。

### manual run を再適用する

上記「generic publish を再実行した場合」を参照。同じ `run_id` を指定して
`manual/2_merge_feature_scores.py --run-id <id> --apply` を再実行すればよい
（`wikidata_food_llm_feature_scores` 側の該当行は消えていないため、MERGE をやり直すだけでよい）。

### PostgreSQL dev を戻す

`dev.dish_category_features` は BigQuery 採用版が正なので、
**PostgreSQL を手動 UPDATE してロールバックしない。**
BigQuery catalog を上記の方法で正しい状態に戻したうえで、

```bash
python3 scripts/20251213T0000_wikidata_food_graph/9_2_sync_dish_category_features.py --schema dev
```

を再実行し、BigQuery 採用版から全置換で戻す。`9_2` はスクリプトが実行前に GCS backup
（`gs://nanitabeyo-private/system/PostgreSQL/csv_export/{timestamp}/dish_category_features.csv`）
を自動作成するので、それを使って直前の状態を確認することもできる。

## production 反映手順

1. dev で `9. API / recommendation の accuracy regression` を通し、問題がないことを確認する
2. Issue に before/after・判断根拠を記録する（このrunbookの受入条件）
3. `9_2_sync_dish_category_features.py --schema public` を実行する
   （このリポジトリでは `public` = 本番。実行は対話確認 `y` の入力を要求される。
   `manual-feature-correction.yml` の `step: sync-dev` は public を意図的にサポートしない。
   本番反映は `db-migrate.yml` に準じた承認フロー・別途の workflow を用意してから行うこと。
   BigQuery `dish_category_features_catalog` 自体は dev/public で分かれていない
   （catalog は共通の採用版）ため、BigQuery側のMERGEは dev/prod 反映より前に完了している）

## recommendationへの影響確認

feature score を変更しただけで、最終表示の並びが同じ比率で変わるとは限らない
（`rel_score × market_salience補正 × dine_out_orderability補正 = final_score`、
`final_score × jitter = order_score`、2〜6枚目は `order_score - diversity penalty` で決まる）。
そのため、変更後は必ず最終順位・出現率まで確認する。

- 対象となる検索条件（例: `dining_pace=quick`）を複数回実行し、jitter の影響を
  1回だけの結果で判断しない
- 修正対象カテゴリ（例: 焼き鳥）が上位へ過剰混入しなくなったか
- 明確な quick 候補（例: ラーメン）が相対的に上位を維持しているか
- 修正対象を下げた結果、別の不自然な候補が繰り上がっていないか
- 変更対象以外の主要条件で回帰がないか

目標は「対象カテゴリを完全に消す」ことではなく、`quick=0.5` が妥当なら、
明確な `quick=1` 候補より一段下がった、条件次第では候補になり得る相対順位にすること。

## 調査の仕方（影響調査）

補正の要否・範囲を決める前に、対象 feature_type/feature_key の全件を一覧化して
相対キャリブレーションを確認する。BigQuery で読み取り専用に確認できる。

```sql
WITH q AS (
  SELECT item_qid, score AS quick_score, note AS quick_note
  FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
  WHERE feature_type = 'dining_pace' AND feature_key = 'quick'
),
l AS (
  SELECT item_qid, score AS leisurely_score
  FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
  WHERE feature_type = 'dining_pace' AND feature_key = 'leisurely'
)
SELECT
  c.item_qid, c.label_ja, q.quick_score, l.leisurely_score,
  JSON_VALUE(q.quick_note, '$.reason') AS quick_reason,
  JSON_VALUE(q.quick_note, '$.confidence') AS quick_confidence
FROM q
JOIN l ON q.item_qid = l.item_qid
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` c ON c.item_qid = q.item_qid
ORDER BY q.quick_score DESC, l.leisurely_score DESC, c.label_ja
```

`quick_reason` が汎用文言（例:「初回レビューで旧CSV値を採用し、2次・3次レビューで変更なし」）の
行は、現行 rubric に対して個別の再検証が行われていない可能性が高いので優先的に見る。
焼き鳥の調査は Issue #1383 のコメントに記録している。
