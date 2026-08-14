# idea検証: youtube-only-coverage-ceiling

**title**: YouTube単独(yt-dlp Route B)の全国カバレッジ上限試算
**判定**: **仮説はほぼ的中(CONFIRMED)— coverage≈23%、k≈4.1、感度分析k60=5.6/8.7、いずれも仮説の数値と一致**

REPORT.md(#1273 v3)の実測funnel(p_attempt=4/20=20%)と、dev.dishesの実測メニュー幅分布を
`1-(1-p)^k`モデルに投入して国内カバレッジ上限を試算した。DBに読み取り専用で接続し、
仮説記述にある全ての数値(coverage≈23%、k≈4.1、感度分析でk60が8.7/5.6に跳ね上がる)を
実測データで再現できた。結論も仮説どおり: **YouTube単独では現実的なメニュー幅(k中央値1、平均1.17)の下で
coverage 20〜23%にとどまり、60%目標には遠く届かない。60%に届けるには店舗あたり平均4カテゴリ分の
独立クエリが必要だが、dev.dishesの実測メニュー幅(中央値1)はこれに遠く及ばない。**

## 実施内容と生の結果

### 実装

`scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/coverage_youtube_only.py` を新規作成した。
`scripts/.env` の `DATABASE_URL`（schema=dev, Supabase pooler）に `psycopg2` (`conn.set_session(readonly=True, autocommit=True)`)
で接続し、以下2クエリをSELECTのみで実行(書き込みは一切行わない)。

```sql
select g.dish_category_id, m.score as market_salience_jp
from dev.dish_category_features g
left join dev.dish_category_features m
    on m.dish_category_id = g.dish_category_id
    and m.feature_type = 'market_salience'
    and m.feature_key = 'region:country:JP'
where g.feature_type = 'gate' and g.score = 1
order by g.dish_category_id
```

```sql
select restaurant_id, count(distinct category_id) as n_categories
from dev.dishes
group by restaurant_id
```

実行環境: システムpython3(3.7.3, `/usr/bin/python3`) + 既存インストール済み `psycopg2==2.9.9`
（PoCの既存スクリプトはstdlib限定方針だが、本試算はDB接続が必須のため`psycopg2`を使用。scratchpadの
Python 3.11環境にはネットワーク経由の`pip install`ができずpsycopg2が入らなかったため、システムpython3の
既存パッケージを利用した）。

### 実行結果(標準出力そのまま)

```
## (1) dish_category_features: gate(score=1) x market_salience(region:country:JP)
gate categories = 134, market_salience matched = 134, score range = [0.42, 0.98]
## (2) dishes per restaurant (COUNT DISTINCT category_id)
{
  "n_restaurants": 2265,
  "mean": 1.1713024282560707,
  "median": 1.0,
  "p25": 1.0,
  "p75": 1.0,
  "p90": 2.0,
  "min": 1,
  "max": 5
}
```

`dish_category_features`は`feature_type='gate' AND score=1`が134件、`feature_type='market_salience' AND
feature_key='region:country:JP'`も134件で完全に1:1 JOINでき、score範囲は0.42〜0.98だった。
test_plan記載の「134件、score分布0.42〜0.98」と完全一致。

`dev.dishes`を`restaurant_id`でGROUP BYした結果はn=2,265店、平均1.171、中央値1.0、p90=2.0、
最大5だった。test_plan記載の「平均1.17、中央値1、n=2,265店」と完全一致。

### Coverage table (p_attempt = 0.20 = 4/20, N = 700,000)

| k | coverage | total queries | time @par5 (4,000-5,000 q/h) |
|---|---:|---:|---:|
| 1 | 20.0% | 700,000 | 140-175h (5.8-7.3d) |
| avg(1.17, 実測平均) | 23.0% | 819,912 | 164-205h (6.8-8.5d) |
| 2 | 36.0% | 1,400,000 | 280-350h (11.7-14.6d) |
| 3 | 48.8% | 2,100,000 | 420-525h (17.5-21.9d) |
| 5 | 67.2% | 3,500,000 | 700-875h (29.2-36.5d) |
| 8 | 83.2% | 5,600,000 | 1,120-1,400h (46.7-58.3d) |
| 13(=134の1割) | 94.5% | 9,100,000 | 1,820-2,275h (75.8-94.8d) |

仮説本文にある「k=4で280万クエリ、約29日」も別途手計算で確認: N×k=700,000×4=2,800,000クエリ、
par5スループット下限4,000q/hで700h=29.2日、上限5,000q/hで560h=23.3日。仮説の「約29日」は
par5の下限スループット(4,000q/h)で計算した保守的な数字と一致する。

### Sensitivity: p_attemptディスカウント別、60%coverageに必要なk

| discount | p_attempt | k for 60% coverage | coverage @ k=avg(1.17) |
|---|---:|---:|---:|
| x1.0(補正なし) | 0.200 | **4.1** | 23.0% |
| x0.75 | 0.150 | **5.6** | 17.3% |
| x0.5 | 0.100 | **8.7** | 11.6% |

仮説の「k≈4.1」「感度分析(p×0.5, ×0.75)ではk60が8.7/5.6に跳ね上がる」と完全一致(小数第1位まで同一)。

### 現実的な上限kでのcoverage点推定(仮説の(7)に対応)

- k=median observed(1): coverage = **20.0%**(60%目標とのギャップ: 40.0pp)
- k=mean observed(1.17): coverage = **23.0%**(60%目標とのギャップ: 37.0pp)

仮説の「dev.dishesの実測平均カテゴリ数/店舗(1.17)をそのまま使うとcoverage≈23%にとどまる」と一致。

出力JSON: `scripts/20260808T0000_restaurant/1273_sns_dish_media_poc/out/coverage_youtube_only_2026-08-13.json`
(全計算結果を構造化保存。上記表はこのファイルの値をそのまま転記)。

## 評価: 仮説の妥当性

仮説が示した4つの定量的主張はいずれも実測データで再現され、数値も一致した。

1. **「dev.dishesの実測平均カテゴリ数/店舗(1.17)をそのまま使うとcoverage≈23%にとどまる」** → 実測23.0%、一致。
2. **「issueの60%目標に必要なkはk≈4.1」** → 実測4.106、一致。
3. **「700,000店×k=4=280万クエリでも約29日で捌ける」** → 実測: par5下限(4,000q/h)基準で29.2日、
   par5上限(5,000q/h)基準で23.3日。「約29日」は保守的な下限側の数字として一致。
4. **「感度分析(p×0.5, ×0.75)ではk60が8.7/5.6に跳ね上がる」** → 実測x0.5→8.70、x0.75→5.64、一致。

仮説の結論(「現実的な店舗あたりカテゴリ数(2〜3程度が上限と推定)とバイアス未補正のpの下では
35〜50%程度が現実的な上限で、60%には届かない可能性が高い」)についても、本試算のcoverage tableで
裏付けられる: k=2で36.0%、k=3で48.8%となり、仮説が言う「2〜3程度が上限」の範囲は
まさに「35〜50%程度」のレンジに対応する。一方、**dev.dishesの実測分布(中央値1、平均1.17、p90=2)を
見る限り、「店舗あたりカテゴリ数2〜3」自体が既に楽観的な仮定**であることが今回明確になった —
実測ではp75ですら1.0であり、2以上のカテゴリを持つ店舗は上位10%程度(p90=2)に限られる。つまり
「現実的な上限k」を実測分布の中心値(中央値1、平均1.17)で置くなら、coverageは20〜23%が
実測ベースの点推定であり、仮説が挙げた35〜50%レンジ(k=2〜3相当)は「メニューが複数カテゴリに
またがる店舗であれば」という条件付きの楽観シナリオに留まる。

したがって仮説の数値的な試算(定式化・感度分析のロジック)は完全に正しく実測でも再現されたが、
「現実的な上限」の解釈については仮説よりもさらに厳しい可能性がある: dev.dishesの分布特性
(中央値1、p75ですら1.0)をそのまま国全体の店舗のメニュー幅とみなすなら、YouTube単独の
現実的なcoverage上限は35〜50%ではなく**20〜25%程度**、60%目標とのギャップは37〜40ptに達する。

## 結論

**仮説の定量ロジック・数値は実測で完全に確認された(CONFIRMED)。** ただし仮説が「現実的な上限」として
言及した35〜50%というレンジは、店舗あたりカテゴリ数k=2〜3を仮定した場合の数字であり、
dev.dishesの実測分布(中央値1、p75=1.0、p90=2.0)そのものに従うなら現実的な点推定は20〜23%に
とどまる。YouTube単独(yt-dlp Route B)は60%目標には届かず、Route A(店舗公式SNSアカウント直接参照)
や複数プラットフォーム合算との組み合わせが必須という、REPORT.mdの既存結論をさらに補強する結果になった。
スループット自体(par5で700,000×k=4=280万クエリを約23〜29日で処理可能)はボトルネックではなく、
真のボトルネックは店舗が実際に持つメニュー幅の狭さ(k中央値1)にあるという仮説の診断も実測で裏付けられた。
