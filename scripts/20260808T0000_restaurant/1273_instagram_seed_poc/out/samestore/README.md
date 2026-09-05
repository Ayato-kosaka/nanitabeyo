# n=4 セル（あと 1 店で ≥5）の狙い先リスト

`7_1_build_coverage.py` の定義で数え直した «あと 1 店で ≥5 になるセル» に対して、
そのセルを埋められそうな店を並べたもの。生成は #1815 の分析ワーカー。

## ファイル

| ファイル | 中身 | 使い方 |
| --- | --- | --- |
| `candB_new_keyword_stores_n4cells.tsv` | n=4 セル単位（256 行）。そのセルの市区町村に居て、店名にそのカテゴリ語を含み、まだ収集していない店の数 | **`of_which_ig_handle_known > 0` の行が、今日そのまま着手できる先** |
| `candA_deepen_existing_stores.tsv` | 既に usable な店を深掘りする案（157 行） | **ほぼ使えない。**下記 |

## ⚠️ 使う前に知っておくこと

**1. ゲート外の QID が 2 つ混ざっている（5 行）。**
`餃子 Q640769` と `焼肉 Q844466` はアプリの JP ゲート（`dish_category_features_catalog` の
`feature_type='gate'` / `feature_key='region:country:JP'`）に入っていない。**狙って埋めても
KPI には数えられない**（同名の別 QID が正: 餃子=Q107014807 / 焼肉=Q2431975）。
`of_which_ig_handle_known > 0` の 135 行のうち **有効なのは 130 行**。

**2. `candA`（既存店の深掘り）は単価が 250 倍悪い。**
実測で 1 セルあたり «既存店の深掘り 約 360 投稿» に対し «新しい店を 1 軒足す 約 1.4 投稿»。
さらに candA の 156 軒のうち **85% は店の Instagram アカウントが判明しておらず、
そもそも投稿を増やす手段が無い**（実際に深掘りできるのは 23 軒だけ）。参考として残すのみ。

**3. 「1 店あたりカテゴリ数 8.55」は約 3 倍の過大評価だった。**
あれは «投稿 20 本以上» バケットのロングテールが押し上げた数字。同一店内で正しく測ると
20 本時点で 2.80（134 カテゴリ限定）。投稿の価値は **5 本目でほぼ尽きる**
（1 本目 : 11〜20 本目 = 7.6 : 1）。

## 列

`candB`: `region / city / category_label / category_qid / candidate_stores / of_which_ig_handle_known`
`candA`: `cell_n / region / city / category_label / category_qid / google_place_id / usable_posts_now / unresolved_stock`
