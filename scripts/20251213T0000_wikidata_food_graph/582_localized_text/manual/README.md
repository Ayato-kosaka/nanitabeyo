# manual: localized text の差し替え（#737）

`dish_category_localized_text_catalog` の `topic_title` / `tagline` を、
LLM バッチ（`1_x` / `2_x`）を回さずに少数だけ直すための運用スクリプト。

## なぜこのディレクトリが要るのか

`鍋料理` の tagline は `source='manual' run_id='20260222T0000_#727'` で入っているが、
**それを入れたスクリプトが残っていない**。アドホックな SQL で入れられたとみられる。
同じ差し替えはこの先も起きるので、再現できる形にした。
（`581_relevance_scoring/manual/` と同じ位置づけ）

## PostgreSQL を直接編集しない

`dish_category_localized_text`（PostgreSQL serving）は
`9_3_sync_dish_category_localized_text.py` で BigQuery から同期される。
PostgreSQL だけ直すと、次に誰かが `9_3` を流した瞬間に消える。必ず

```text
BigQuery: dish_category_localized_text_catalog（このスクリプト）
  → PostgreSQL: dish_category_localized_text（9_3 で同期）
```

の順で反映する。

## 季節の名指しを外す（#737）

季節補正でランキングを直しても、文言が季節に固定されていると
「8 月なのに『冬のご褒美』と出る」という形で残る。

gate 通過 134 件の localized text を季節語
（冬 / 夏 / 春 / 秋 / 寒 / 暑 / 涼 / 温もり / 旬 ほか）で全数走査した結果:

| 料理 | tagline | 判定 |
|---|---|---|
| **鍋料理** | 熱とだしの旨みで**冬のご褒美**が完成する | **要修正**。季節を名指ししている |
| おでん | じんわりと**温もり**が広がる | 据え置き。温度の描写で季節の名指しではない。スコア側で夏は沈む |
| つけ麺 | **冷えた**麺を濃いスープに沈めた瞬間… | 修正不要。料理の説明 |
| 素麺 | きりっと**冷えた**細い麺をすすれば… | 修正不要。料理の説明 |
| 和食 | **旬**の味わいがひと口ごとに… | 修正不要。むしろ季節非依存の良い書き方 |

判断の基準は「**その月に読んで嘘にならないか**」。
「冬の」「夏の」のような時期の名指しは外し、料理そのものの描写（熱い・冷たい）は残す。

## 使い方

`.github/workflows/db-script-run.yml`（workflow_dispatch）から実行する。

```bash
script_path: scripts/20251213T0000_wikidata_food_graph/582_localized_text/manual/1_upsert_localized_text.py
args: --run-id "20260825T0000_#737" --input-jsonl /tmp/localized.jsonl --dry-run
```

`input_file_path` / `input_file_content` に JSONL を渡す（1 行 1 件）。

```json
{"item_qid":"Q1962004","locale":"ja","tagline":"煮えた具をすくって口に入れた瞬間、熱とだしの旨みが一気に広がる。","note":"#737 8月に『冬のご褒美』と出るため季節の名指しを外す"}
```

`--dry-run` は **before の文言を必ず表示する**（元が分からないと差し替えの妥当性を判断できない）。
外すと実際に UPDATE する。その後 `9_3` で dev へ同期する（**オーナー承認が要る**）。

## validation（すべて通らないと 1 件も反映しない）

- `item_qid` / `locale` が空でない
- `topic_title` / `tagline` のどちらかは指定されている
- `note`（変更理由）が空でない
- 対象行が catalog に実在する（**新規作成はしない**。それは `1_x` / `2_x` の責務）

## 季節語の走査クエリ

新しい文言を入れたあと、季節の名指しが混ざっていないか確認するのに使う。

```sql
WITH gated AS (
  SELECT DISTINCT item_qid FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
  WHERE feature_type = 'gate' AND score > 0
)
SELECT l.locale, c.label_ja, l.topic_title, l.tagline
FROM `food-scroll.wikidata_food_graph.dish_category_localized_text_catalog` l
JOIN gated g USING (item_qid)
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` c USING (item_qid)
WHERE REGEXP_CONTAINS(CONCAT(IFNULL(l.topic_title,''), ' ', IFNULL(l.tagline,'')),
  r'冬|夏|春|秋|寒|暑|涼|温もり|あたた|温ま|冷え|季節|旬|winter|summer|spring|autumn|chilly|cold day|hot day')
ORDER BY l.locale, c.label_ja
```
