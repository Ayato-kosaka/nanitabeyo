# INVESTIGATE — 違和感の原因を確定する

**推測で補正しない。** 「焼き鳥が変」という一件のみを見て値を書き換えると、
その feature の相対キャリブレーション（他カテゴリとの整合性）を壊す。
必ず対象 `feature_type`（例: `dining_pace`）の**全件**を一覧化してから判断する。

## 1. 対象 feature の全件を一覧化する

BigQuery（`food-scroll.wikidata_food_graph`）に読み取り専用でアクセスできる場合は
そのまま実行する。書き込み権限しか無い/資格情報が無いセッションでは、BigQuery MCP の
readonly ツールでも同じことができる。

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

`feature_type` / `feature_key` を対象のものに差し替える。2軸（例: quick/leisurely）を
持つ feature でなければ `l` 側の JOIN は不要。

## 2. 「レビューされていない値」を見分ける

`note.reason` が汎用文言（実例:「初回レビューで旧CSV値を採用し、2次・3次レビューで
変更なし。」）のものは、**現行 rubric に対する個別の再検証が行われていない**可能性が高い。
これは #1383 で焼き鳥・やきとん・串カツを特定した際の実際の手がかりだった
（一方、個別の理由が書かれている行は、少なくとも一度は rubric に照らして判断されている）。

汎用文言かどうかで自動的に「間違っている」と決めつけないこと。あくまで
「優先的に人間の目で見るべき候補」を絞り込むためのフィルタである。

## 3. 相対キャリブレーションを確認する

違和感のあるカテゴリ単体を見るのではなく、同じスコア階層の他カテゴリと比較する。

- そのカテゴリは、同じ `score=1` の他カテゴリと同程度に代表的か
- そのカテゴリは、一段階下の `score=0.5` の他カテゴリの説明と、むしろ整合しないか
- 同じ `score=1` 集合の中に、同様の過大/過小評価が他にもないか（1件だけ直して終わりにしない）
- `score=0.5` 側の説明文が、対象カテゴリにそのまま当てはまらないか

実例（#1383）: `dining_pace:quick=1` の中で「焼き鳥・やきとん・串カツ」は、
店型としての「居酒屋」（`quick=0.5`）と全く同じ利用像（串を数本ずつ注文し、飲みながら
食べる）を持つのに、個別料理として採点したときだけ `quick=1` になっていた。
一方「寿司・タイ料理・ベトナム料理」は、単品利用と会食利用の**両方が独立に成立する**
代表像を持つため `quick=1 / leisurely=1` のままで問題ないと判断した。

「同じ理由が当てはまるカテゴリが他にもないか」を機械的に横展開して確認すること
（今回は「居酒屋の定番品目を個別料理として単独採点しているもの」を軸に探した）。

## 4. Case A / Case B を判定する

対象 feature の rubric ドキュメント（例:
`581_relevance_scoring/866_dining_pace/dining_pace_prompt.md`）を読み、次のどちらかを選ぶ。

### Case A: 個別カテゴリだけが過大/過小

- rubric の定義・スコア基準・軸の独立性などは妥当
- 一部カテゴリの当てはめだけが rubric からズレている
- → rubric ドキュメントは（必要なら該当カテゴリの記載例だけ）修正し、
  データは `APPLY.md` の manual correction で直す

### Case B: 判定基準自体が広すぎる/狭すぎる

- 同じ score 階層に、同種の問題を抱えるカテゴリが多数ある
- rubric の定義文・アンカー例・境界の説明そのものが再現性を欠いている
- → まず rubric ドキュメントの定義・アンカー例・境界を修正する。
  必要なら該当 feature を LLM で再採点する（`1_1〜3_1` の通常パイプライン）。
  manual correction は「rubric 修正後、再採点を待たずに明らかな誤りだけを
  速やかに直す」用途に限定し、rubric 修正そのものの代替にはしない。

判断に迷う場合は、影響範囲（該当する可能性のあるカテゴリ数）で決める。
数件（目安: 5件未満）に閉じるなら Case A、
score 階層全体・複数カテゴリ群に及ぶなら Case B を疑う。

## 5. 仕様と実データの不整合を残さない

Case A・Case B いずれでも、**rubric ドキュメントの記載例（キャリブレーション表・
アンカー例）が古い値のまま残っていないか**を必ず確認する。
rubric に書かれた例と実データの値が食い違ったまま放置すると、次に rubric を読んだ
人間/LLM が古い例に引っ張られて同じ誤りを再生産する。

`866_dining_pace/dining_pace_prompt.md` のようなドキュメントには変更履歴セクション
（例: §14）があるので、そこに「何を・なぜ・Issue番号つきで」変更したかを追記する
（バージョン番号を上げる）。
