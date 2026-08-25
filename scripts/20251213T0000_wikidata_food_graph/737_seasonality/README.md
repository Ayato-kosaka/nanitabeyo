# #737 seasonality（Wikipedia 月次ページビュー → season feature）

## 何を作るか

料理カテゴリごとの **12 か月の季節指数**を作り、`dish_category_features` の
`feature_type='season'` として推薦のスコア補正へ流す。

夏におでん・鍋が上位固定される問題（[#737](https://github.com/Ayato-kosaka/nanitabeyo/issues/737)）への対応。

```text
Wikimedia Analytics API
  → dish_category_seasonality_raw     (1_2: 月次PV。append-only)
  → dish_category_seasonality_curve   (1_3: 12か月の指数。派生値)
  → dish_category_seasonality_review  (2_2: 人の判断。append-only)
  → dish_category_features_catalog    (3_1: approve された分だけ MERGE)
  → PostgreSQL dish_category_features (9_2: 全置換で同期)
```

## なぜ LLM ではなく Wikipedia なのか

この feature は他の `581_relevance_scoring` 系（timeSlot / scene / taste …）と違い、
**LLM の主観ではなく実測データ**から作る。

| | Wikipedia Pageviews | LLM rubric |
|---|---|---|
| 料金 | 0（CC0・商用可） | 数十円 |
| 履歴 | 5 年分が今すぐ | 無い |
| 根拠 | 実際の閲覧行動 | モデルの常識 |
| 海外展開 | 言語版を変えるだけ | 国ごとに rubric を書き直す |

実測（134 件を全件処理）では、季節性のある料理だけがはっきり分離できた。

| 記事 | 1月 | 7月 | 8月 | 12月 | 振幅 |
|---|---|---|---|---|---|
| おでん | 1.60 | 0.53 | 0.46 | **2.16** | **4.7x** |
| 鍋料理 | 1.71 | 0.52 | 0.49 | 1.99 | 4.1x |
| かき氷 | 0.45 | **3.08** | 2.23 | 0.45 | **7.4x** |
| 冷やし中華 | 0.37 | 2.63 | 1.66 | 0.33 | 8.0x |
| ウナギ | 0.94 | **2.43**（土用の丑） | 1.08 | 0.69 | 3.5x |
| 焼き鳥（対照） | 1.01 | 1.00 | 0.94 | 0.94 | **1.1x** |
| ハンバーグ（対照） | 1.04 | 0.92 | 0.80 | 1.09 | 1.4x |

対照群が平坦なので、これはノイズではない。気温型（鍋）も歳時記型（ウナギ・
クリスマスケーキ）も、**区別せず 1 本の曲線に入る**のがこの方式の効きどころ。

## レビューの判断基準（2_1 → 2_2）

**機械的に全採用してはいけない。** 実測で出た偽陽性:

| 項目 | 出た結果 | 実際は | 判定 |
|---|---|---|---|
| カフェ | ピーク 9 月 1.91x | 記事は業態の解説で、外食需要と無関係 | reject |
| 和食 / 懐石料理 | 11 月 / 5 月 | 「和食の日(11/24)」等の記事都合 | reject |
| 餃子 | 振幅 2.04x | sitelink が「日本の餃子」(640PV) を指していた。本体の「餃子」(7,858PV) は 1.3x で平坦 | reject（記事の取り違え） |
| チーズタッカルビ | 冬型 | 月 14PV。統計として成立していない | reject |
| ショートケーキ | 12 月 2.69x | クリスマスケーキ。**実在の需要** | approve |
| 韓国フライドチキン | 12 月 3.52x | クリスマスのチキン。**実在の需要** | approve |

判断は次の順で行う。

1. **記事はその料理そのものか。** 業態（カフェ・居酒屋）、国の料理（和食・中華料理）、
   別記事へのリンク（日本の餃子）は reject
2. **曲線の山は「食べたくなる時期」で説明できるか。** 気温（鍋・かき氷）、
   行事（土用の丑・クリスマス）、旬（牡蠣・蟹）のどれかで言葉にできること。
   説明が付かない山は reject
3. **PV は十分か。** 閾値は通っていても、月 1000PV 未満は単発の話題で動きやすい。
   説明が付かないなら reject（**迷ったら入れない**）

reject しても損は無い。`season` の行が無いカテゴリは推薦側の `COALESCE(...,1)` で
補正係数がちょうど 1.0 になり、**完全に現状どおり**動く。

## 実行手順

DB / BigQuery に影響する操作は `.github/workflows/db-script-run.yml`
（workflow_dispatch）から実行する。ローカルから資格情報を使わない。

```bash
# 1. 対象記事リスト（BigQuery 読み取りのみ）
script_path: scripts/20251213T0000_wikidata_food_graph/737_seasonality/1_1_export_input.py

# 2. ページビュー取得（実測で 122 件 15 分。--resume で中断から再開できる）
script_path: .../1_2_fetch_pageviews.py
args: --run-id 20260825T0000

# 3. 季節指数を計算
args: --run-id 20260825T0000 --dry-run   # 何件がレビュー対象になるかだけ見る
args: --run-id 20260825T0000

# 4. レビュー用に書き出す
script_path: .../2_1_export_review.py
args: --run-id 20260825T0000

# 5. 判断を入れる（decision と reason を埋めた JSONL を input_file_content で渡す）
script_path: .../2_2_apply_review.py
args: --run-id 20260825T0000 --input-jsonl /tmp/review.jsonl --reviewer owner --dry-run
args: --run-id 20260825T0000 --input-jsonl /tmp/review.jsonl --reviewer owner

# 6. features へ投入
script_path: .../3_1_publish_features.py
args: --run-id 20260825T0000 --dry-run
args: --run-id 20260825T0000

# 7. PostgreSQL dev へ同期（★オーナー承認が要る）
script_path: scripts/20251213T0000_wikidata_food_graph/9_2_sync_dish_category_features.py
args: --schema dev --dry-run
args: --schema dev
```

## 推薦側での効き方

`api/src/v1/dish-categories/dish-categories.repository.ts` が、
`market_salience` / `dine_out_orderability` と同じ形の補正係数として掛ける。

```text
final_score = rel_score
            × (1 - w_market  + w_market  × market_salience)
            × (1 - w_orderab + w_orderab × dine_out_orderability)
            × (1 - w_season  + w_season  × season_score)     ← #737
```

- `score = LEAST(index_value, 1.0)`。**1.0 が「無補正」**（係数がちょうど 1.0 になる）
- 1 を超える押し上げはしない。夏物を上げるのはスレートの「旬枠」でやる（Phase 2）
- `feature_key` は `<region_scope>:month:MM`。API は狭い地域 → 広い地域 → `global:month:MM`
  の順に探し、最初に当たった 1 件を使う。**`global` のデータは今は無いが、
  後から入れるだけで海外にも効く**ようにキーだけ通してある
- `dish_category_recommendation_weight_season`（Remote Config）を `0` にすると
  デプロイなしで完全に無効化できる

一時 Postgres で実 SQL を流した結果（`w_season=0.5`、jitter=0、本番の実測値）:

| シナリオ | おでん | 鍋料理 | 焼き鳥 / ラーメン |
|---|---|---|---|
| 8 月 | 0.8940 → **0.6526** | 0.7344 → **0.5471** | 変化なし |
| 12 月 | 0.8940（変化なし） | 0.7344（変化なし） | 変化なし |
| `w_season=0` | 0.8940（完全に元へ） | 0.7344 | 変化なし |

## 曲線を作り直すとき

`build_curve.sql` は `CREATE OR REPLACE` なので、run_id を変えて `1_3` を流し直せば
別バージョンの曲線を作れる。**review は run_id 単位**なので、曲線を作り直したら
レビューもやり直しになる（判断の根拠にした数字が変わるため）。

`publish_features.sql` の `WHEN NOT MATCHED BY SOURCE ... THEN DELETE` は、
その `region_scope` の season 行だけを対象にする。以前 approve していたものを
reject へ変えた場合、古い補正が残らないようにするため。

## 未完成月を捨てる仕組み（実装時に見つけた事故）

Wikimedia は**直近月の集計が遅れる**ことがあり、その月だけ全記事いっせいに落ちた値が返る。
2026-08-25 時点で 2026-07 を引いた実測:

| 記事 | 2026-06 | 2026-07 |
|---|---|---|
| おでん | 2,612 | **200** |
| ラーメン | 15,442 | **444** |
| 焼き鳥 | 2,753 | **80** |

記事単位ではなく**全体で**起きるので、素直に指数を計算すると全カテゴリへ
「7 月は壊滅的に不人気」という偽の季節性を刻む。ガード無しで計算した場合:

| 記事 | 7 月指数 | 振幅 | 本来 |
|---|---|---|---|
| おでん | 0.09 | 15.6x | 4.7x |
| ラーメン | 0.04 | 34.8x | 1.4x |
| **焼き鳥（対照群）** | **0.04** | **34.4x** | **1.1x** |

対照群であるはずの焼き鳥が振幅 34 倍になる。これがそのまま publish されると
**7 月は全カテゴリの score が 0.1 以下**になり、季節補正が推薦を壊す。

そこで `build_curve.sql` が「その月の全記事合計が中央値の
`min_month_completeness_ratio`（既定 0.5）未満の月」を捨てる。
本物の季節性は夏物と冬物が逆方向に動くため**合計はほとんど動かない**のに対し、
この断絶は 97% 減なので取り違える余地が無い。固定の「N か月前まで」にしないのは、
集計の遅れが常に同じ長さとは限らないため。捨てた月は `1_3` が必ずログへ出す。

## 制約・既知の限界

- **Wikimedia のレート制限**（2026 年に導入）。連続アクセスすると 429 になる。
  `sleep_sec: 1.3` 以上が必要。OAuth で上限を上げられるが未対応
- **閲覧数は「調べた人」であって「食べた人」ではない。** テレビ放映等で跳ねる。
  5 年分の同月平均を取ることで単発スパイクは薄まるが、ゼロにはならない
- **sitelink が無いカテゴリが 12 件**ある（かき氷・牛すじ煮込み・蟹料理・牡蠣料理など）。
  `1_1` が `label_ja` で引き直すが、当たった記事が正しいかは人が見る
- 南半球・熱帯は未対応（`region_scope: "global"` で別 run を流せば入れられる）
