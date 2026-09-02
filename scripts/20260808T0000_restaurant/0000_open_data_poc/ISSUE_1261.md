# Issue #1261 実測結果

実測日: 2026-08-10

## 判定

現時点の **Overture + IFAS union は No-Go**。現行DB 103,125店に対して自動採用できたのは49,203店（47.71%）で、閉店除外後95%という合格線から大幅に離れています。Overture単体は45,257店（43.89%）、IFASの上積みは3,946店（+3.82pt）でした。

閉店レビュー前のraw値ですが、未一致53,544店の大半が閉店であるという証拠がない限り、目視分類だけで95%へ届く差ではありません。現unionをそのまま初期seedに採用せず、旧法期自治体台帳の追加と、欠落店carry-forwardを前提に評価します。

完全な機械可読値は [`issue_1261_results_2026-08-10.json`](./issue_1261_results_2026-08-10.json) に固定しました。reference CSVとsource snapshotは `.gitignore` 対象で、アプリDBは更新していません。

## 名寄せ改善

IFAS 261,896候補をOvertureへ照合した累積値は次のとおりです。

| Level | 方法 | 一致 | 一致率 |
|---|---|---:|---:|
| L0 | 従来正規化 + 150m | 37,949 | 14.49% |
| L1 | NFKC、法人格・末尾店種別語、異体字 | 39,577 | 15.11% |
| L2 | 150m block + pg_trgm互換trigram | 42,688 | 16.30% |

目標40%超には未達です。現行DB union側では exact 44,949、L1追加928、L2追加3,326、曖昧378でした。表記揺れだけでなく、IFASの公開範囲、座標欠損、旧法期台帳欠落が支配的と考えられます。

## 連絡先充足と重複

- Overture `websites`: 56.14%
- Overture `socials`: 90.44%
- websiteまたはsocial: 99.96%
- websiteとsocialの両方: 46.62%
- L1名称類似度0.75以上かつ50m以内でcluster後: 789,237件（入力789,612件、余剰375件）

これらはfieldの存在率です。URLの到達性、公式性、店舗支店との厳密な対応は別途検証が必要です。

## 残作業

1. `legacy_sources.example.json` を基に、東京都・大阪市等の旧法期CSVを取得・ジオコーディングし、provenance付きでunionする。
2. `out/reference-matching/unmatched_review_sample.csv` の100件を `seed_missing` / `matching_failure` / `closed` に目視分類する。
3. `seed_missing` を `google_place_id` + 最小情報でcarry-forwardした場合の追加件数と運用コストを算出する。

東京都・大阪市の公開台帳は施設名・所在地を含みますが、緯度経度を持たない配布もあるため、原典をそのまま推測mappingせず、manifestとジオコーディング結果を分離して投入します。
