#!/usr/bin/env python3
"""#1629 GET /v1/restaurants/search を **実運用と同じ条件で** 測り、遅いプランなら赤にする。

## なぜ要るのか

「投稿が多い順」を入れた commit 3dfd061d のあと、dev の
GET /v1/restaurants/search（東京駅・半径 20,000m・limit 20）が
**7,625 / 16,222 / 25,954 ms** かかった（queue_ms は 1〜2 ms なので接続待ちではない）。

ところが同じ SQL を **literal 埋め込みで EXPLAIN ANALYZE すると 46〜270 ms で速い**。
測り方が実運用と違っていたのである。Prisma が投げるのは prepared statement なので、
PostgreSQL は同じ文を数回実行したあと **generic plan**（パラメータの値を見ないプラン）
へ切り替える。半径がプランナから見えなくなると GIST 索引の見積りが既定値へ落ち、
**restaurants を駆動表にして半径内の全店を読む**プランが選ばれる。

⚠️ psycopg2 の execute(sql, params) はクライアント側で値を埋め込むので、
   そのまま EXPLAIN しても prepared statement にならない。
   **plan_cache_mode は効かない**（＝ generic plan を測ったことにならない）。
   このスクリプトが PREPARE / EXECUTE を使うのはそのためである。

## 何を測るのか

1. 母数（restaurants / 投稿 / 投稿を持つ店 / 半径内の店舗数）
2. `custom plan`（最初の数回）と `generic plan`（落ち着く先）の両方で
   EXPLAIN (ANALYZE, BUFFERS) EXECUTE
3. **判定**: 形によって見るものが違う。

   - `q` の無い形（既定順 / 距離順）: **custom / generic の両方**で、
     **restaurants から読んだ延べ行数**を見る。«半径内の全店を読む» プランへ倒れると、
     この数が半径に比例して跳ね上がる
   - **`q` のある形（店名検索）: 3 文字の未変更の枝に対する «倍率»** を見る（#1951）。
     この枝は行数でもプランの形でも判定できないと実測で分かった。理由は
     `NAME_SLOWDOWN_LIMIT` の上のコメント

   ⚠️ **片方だけ見てはいけない。** #1686 で generic plan を直したあと、
      このスクリプトが generic しか判定していなかったため、
      **custom plan が 11〜13 秒のまま «✅» と表示された**（dev run 33229509189）。
      «空振りを ✅ と読む» のを構造的に潰すため、両方を判定対象にしてある。

   再現環境（restaurants 570,000 行 / 投稿を持つ店 7,985 / limit 20。
   max_parallel_workers_per_gather=4 / random_page_cost=1.1 ＝ dev と同じプランが出る設定）:

   | | custom 延べ行数 / 所要 | generic 延べ行数 / 所要 |
   | --- | ---: | ---: |
   | #1686 時点 半径 20km    | 272,612 / 994 ms | 60 / 173 ms |
   | #1686 時点 半径 1,500km | 574,385 / 1,733 ms | 8,045 / 173 ms |
   | 修正後 半径 20km        | 60 / 158 ms | 60 / 167 ms |
   | 修正後 半径 1,500km     | 8,045 / 167 ms | 8,045 / 172 ms |

## 測る SQL は写経しない

⚠️ 「repository を直したのに、このスクリプトの写経が古いままで同じ遅い数字が出て
   «直っていない» と誤読しかけた」事故が起きている。

そこで SQL は `scripts/db-checks/sql/*.sql` から読む。このファイルは
`api/src/v1/restaurants/restaurants.order-by-posts-plan.spec.ts` が
**repository の組み立て結果と一致することを機械検査している**ので、
写経がずれることは起きない（ずれたら `pnpm --filter api exec jest` が赤くなる）。

## 読み取り専用である

SELECT と、SELECT に対する PREPARE / EXPLAIN しか実行しない。接続も readonly で張る。

## 使い方

    python scripts/db-checks/measure_order_by_posts.py --schema dev
    python scripts/db-checks/measure_order_by_posts.py --schema dev --assert

`--assert` を付けると、上の判定のどれかが赤いときに **終了コード 1** を返す
（ラチェットとして使う）。

環境変数:
    DATABASE_URL … PostgreSQL 接続文字列（必須）
"""

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"

# 東京駅。オーナーが実際に踏んだ検索地点
TOKYO_LAT, TOKYO_LNG = 35.681236, 139.767125
# 日本全体を映したときの地図の中心（app-expo の REGION_JP）と viewport の半径
JP_LAT, JP_LNG = 36.2048, 138.2529

# 測る «クエリの形»。(スナップショット名, limit, 説明)
#
# #1834 【設計】**LIMIT は SQL に literal で埋まる。つまり limit ごとに別のプランである。**
#
# ここは長らく «既定順 / limit 20» の 1 本しか測っていなかった。ところが
# `QueryRestaurantsDto.limit` は @Max(100) なので、公開 API はそのまま 100 を受ける。
# 本番で «既定順 + limit 100» が **26.7 秒**かかっていたのに、
# ラチェットは緑のままだった（#1834。SNS 取り込みが内部から limit 100 で呼んでいた）。
#
# ⚠️ **「クライアントが今そう呼んでいないから」を理由に外さないこと。**
#    守るのは «API が受け付ける最悪の形» であって «今の呼ばれ方» ではない。
# ⚠️ 名前は `restaurants.order-by-posts-plan.spec.ts` が書き出すスナップショットと一致させる。
#    ずれたら jest が赤くなる（写経しないための仕組み）。
# (スナップショット名, limit, 説明, q, role)。q は店名検索の枝だけが使う（他は None）。
# role は店名の枝の相対比較に使う: "short"（直した形）/ "baseline"（3 文字の基準）/ "control"（直す前）。
# q が None の形は role も None で、従来どおり «行数の予算» で判定する。
SHAPES = (
    ("search_nearby_restaurants.default", 20, "既定順（投稿が多い順）・クライアント既定", None, None),
    ("search_nearby_restaurants.default_limit100", 100, "既定順・API が受け付ける上限", None, None),
    ("search_nearby_restaurants.distance_limit100", 100, "距離順・SNS 取り込みが内部から呼ぶ形", None, None),
    # #1951 trgm 索引が効かない短い店名。中間一致（`%一蘭%`）だと 2 文字から trigram が
    # 取れず、半径内の行をヒープから全部読んで name で捨てる形になり本番 20.34 秒だった。
    # 前方一致 / 語頭一致へ切り替わって trgm 索引に乗っているかをここで見る。
    # ⚠️ 「一蘭」は実際に本番で 20.34 秒かかった店名そのもの。合成値へ置き換えないこと。
    ("search_nearby_restaurants.byname_short", 20, "店名 2 文字（#1951 の本命）", "一蘭", "short"),
    # 比較対象。3 文字以上は従来どおり中間一致で trgm 索引に乗るはず
    ("search_nearby_restaurants.byname", 20, "店名 3 文字以上（従来の中間一致・**基準**）", "八王子", "baseline"),
    #
    # ⚠️ **対照群。これは «trgm 索引に乗らないのが正しい» 形である。**
    #
    # 検査そのものが働いていることを、毎回この 1 本で確かめる。#1629 / #1686 で
    # «判定が空振りしていたのに ✅ と表示されて見落とす» を二度やっているので、
    # «本物を入れたら赤くなるか» を検査の側に持たせる。
    # 中身は «2 文字 × 中間一致» ＝ #1951 で直す前の形そのもの（本番 20.34 秒 /
    # dev generic・半径 1,500km で 20,220 ms）。
    ("search_nearby_restaurants.byname", 20, "⚠️対照群: 2 文字 × 中間一致（直す前の形）", "一蘭", "control"),
)

# 測る条件。(ラベル, 中心 lat, 中心 lng, 半径 m)
#   ⚠️ 20,000m / limit 20 はオーナーが実際に踏んだ値。必ず含めること
# ⚠️ **中心も半径も «オーナーが実際に投げた値» を必ず含めること。**
#
# 2026-08-29、オーナーに「まだ直っていない」と 3 度目に言われて BigQuery の実ログを
# 時系列で並べたところ、`SearchRestaurants` が **41〜42 秒**かかっており、
# その後ろで `SearchNearbySavedRestaurants` が 42 秒待たされて一斉に流れ出していた
# （= 遅いクエリ 1 本が DB 接続を握り、他を直列化させている）。
#
# それまでこのファイルは **東京駅と REGION_JP の 3 通りしか測っていなかった**。
# オーナーが地図を動かした先（関東北部・中間半径）は 1 度も踏んでおらず、
# EXPLAIN は緑のまま «直った» と 2 度報告してしまった。
#
# 中心を固定した半径スイープでは、この穴は永久に見つからない。
CASES = (
    ("東京駅から 20km", TOKYO_LAT, TOKYO_LNG, 20_000),
    ("東京駅から 50km", TOKYO_LAT, TOKYO_LNG, 50_000),
    ("日本全体（中心 REGION_JP / 半径 1,500km）", JP_LAT, JP_LNG, 1_500_000),
    # 以下 3 つは実ログの座標そのまま（同時刻に saved 側が 42 秒待たされた地点）
    ("⚠️実測: 36.474/139.304 半径 228km", 36.474490512258626, 139.30424323305488, 228_012),
    ("⚠️実測: 36.020/139.637 半径 74km", 36.020342181469665, 139.63704250752926, 74_225),
    ("⚠️実測: 37.352/137.337 半径 1,148km", 37.35204818493608, 137.33717987313867, 1_147_826),
)

# 判定のしきい値。«走る行数が limit 件で一定» が保てているなら、
# restaurants から読む延べ行数は «投稿を持つ店の数 + limit の数倍» に収まる。
# 半径内の全店を読むプランへ戻ると桁が変わるので、緩めに取っても検出できる
ROWS_BUDGET_MULTIPLIER = 4

# 同じ文を何回まわすか。1 回だと «初回のキャッシュ未命中» を «構造的に遅い» と読み違える
REPEATS = 3


def one(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return row[0] if row else None


def section(title):
    logger.info("")
    logger.info("=" * 72)
    logger.info("# %s", title)
    logger.info("=" * 72)


def load_sql(name):
    """repository が組み立てた SQL とバインド値の «名前の列» を読む。

    バインド位置は半角疑問符なので $1, $2 … へ直す。
    ⚠️ SQL のコメントに半角疑問符が混ざっていると位置がずれる。
       repository 側でそれを禁じ、jest が個数一致を検査している。
    """
    raw = (SQL_DIR / f"{name}.sql").read_text(encoding="utf-8").rstrip().rstrip(";")
    names = json.loads((SQL_DIR / f"{name}.params.json").read_text(encoding="utf-8"))
    counter = [0]

    def to_positional(_match):
        counter[0] += 1
        return f"${counter[0]}"

    sql = re.sub(r"\?", to_positional, raw)
    if counter[0] != len(names):
        raise SystemExit(
            f"❌ {name}: プレースホルダ {counter[0]} 個に対して名前が {len(names)} 個。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 で書き出し直すこと"
        )
    return sql, names


def bind(names, lat, lng, radius, limit, q=None):
    """バインド値を «名前の列» の順に並べる。

    ⚠️ ここを手書きの配列にしないこと。SQL の形を変えるとバインドの順番も変わり、
       radius と limit が入れ替わったまま «別のクエリを測って» 読み違えた実績がある。
       名前の列は jest が repository から書き出しているので、ずれようがない。
    """
    values = {"lat": lat, "lng": lng, "radius": radius, "limit": limit}
    if q is None:
        return [values[n] for n in names]

    # #1951 店名の枝。中間一致は 1 本、短い店名は 前方一致 / 語頭一致 の 3 本になる。
    # **バインドする順番はスナップショットの params.json が持っている**ので、
    # ここでは «q が何本目か» を数えて、その本数ぶんのパターンを順に当てる。
    # ⚠️ パターンの形を repository と別に書いているのはここだけである。ずれると
    #    «別のクエリを測る» ことになるので、本数が合わなければ落とす。
    patterns_by_count = {
        1: ["%{}%".format(q)],
        3: ["{}%".format(q), "% {}%".format(q), "%\u3000{}%".format(q)],
    }
    q_count = names.count("q")
    patterns = patterns_by_count.get(q_count)
    if patterns is None:
        raise SystemExit(
            "❌ q のバインドが {} 本ある形は想定していない。"
            " repository の buildNameMatch を変えたなら、ここも一緒に直すこと".format(q_count)
        )

    out = []
    q_index = 0
    for n in names:
        if n == "q":
            out.append(patterns[q_index])
            q_index += 1
        else:
            out.append(values[n])
    return out


def run_counts(cur, schema):
    section("1. 母数（«何行あるから遅い» のかを最初に潰す）")

    total = one(cur, "SELECT count(*) FROM restaurants")
    logger.info("restaurants の総件数: %s", f"{total:,}")

    alive = one(cur, "SELECT count(*) FROM dish_media WHERE deleted_at IS NULL")
    logger.info("dish_media（生存）: %s  ← post_counts CTE が 1 回走る行数", f"{alive:,}")

    with_posts = one(
        cur,
        """
        SELECT count(DISTINCT d.restaurant_id)
        FROM dish_media dm JOIN dishes d ON d.id = dm.dish_id
        WHERE dm.deleted_at IS NULL
        """,
    )
    logger.info(
        "投稿を持つ店: %s 件（全店舗の %.4f%%）  ← 投稿枠が走る行数の上限",
        f"{with_posts:,}",
        100.0 * with_posts / total if total else 0.0,
    )

    logger.info("")
    for label, lat, lng, radius in CASES:
        n = one(
            cur,
            "SELECT count(*) FROM restaurants r WHERE ST_DWithin(r.location, "
            "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s::double precision)",
            (lng, lat, radius),
        )
        logger.info("%-46s 半径内の全店 %10s 件", label, f"{n:,}")
    logger.info("")
    logger.info("  ← 所要時間が右の «半径内の全店» に比例するなら、駆動表を間違えている")
    return with_posts


# ⚠️ 数え方の実装は `explain_rows_read.py` が正本（3 本のスクリプトが共有する判定なので、
#    psycopg2 を要らない場所へ出して CI のテストで縛ってある）。ここへ書き戻さないこと。
from explain_rows_read import (  # noqa: E402,F401
    restaurants_rows_read_with_bound,
    verdict_against_budget,
)


def explain(cur, sql, nparams, params, generic):
    cur.execute("DEALLOCATE ALL")
    cur.execute(f"PREPARE q AS {sql}")
    cur.execute(
        "SET LOCAL plan_cache_mode = %s",
        ("force_generic_plan" if generic else "force_custom_plan",),
    )
    placeholders = ",".join(["%s"] * nparams)
    cur.execute(f"EXPLAIN (ANALYZE, BUFFERS) EXECUTE q({placeholders})", params)
    plan = [row[0] for row in cur.fetchall()]
    return plan, timings(plan)


def timings(plan):
    """EXPLAIN の出力から «実行 / 計画 / JIT» の 3 つを取り出す。

    ⚠️ 合計の ms だけを見ると «プランは正しいのに遅い» の内訳が分からない。
       #1687 のあと custom plan の 20km だけ 4,112 ms 出ており、読む行数は
       正しかった（= プランは正しい）。残りが JIT なのか初回のキャッシュ未命中
       なのかを切り分けるために、この 3 つと «同じ文を繰り返したときの推移» を出す。
    """
    out = {"exec": None, "plan": None, "jit": None}
    for line in plan:
        t = line.strip()
        if t.startswith("Execution Time"):
            out["exec"] = float(t.split(":")[1].strip().split(" ")[0])
        elif t.startswith("Planning Time"):
            out["plan"] = float(t.split(":")[1].strip().split(" ")[0])
        elif t.startswith("Timing:") and out["jit"] is None:
            m = re.search(r"Total ([0-9.]+) ms", t)
            if m:
                out["jit"] = float(m.group(1))
    return out


def run_explain(cur, schema, with_posts, full_plan, do_assert):
    section("2. custom plan と generic plan の両方で測る")
    logger.info("custom  = 最初の数回。半径の «値» がプランナから見えている")
    logger.info("generic = Prisma の prepared statement が落ち着く先。値が見えない")
    logger.info("")
    logger.info(
        "判定: **custom / generic の両方**で、restaurants から読む延べ行数が "
        "«投稿を持つ店 %s + その形の limit» の %s 倍を超えたら赤",
        f"{with_posts:,}",
        ROWS_BUDGET_MULTIPLIER,
    )
    logger.info("測る形: %s", " / ".join(f"{n}(limit {l})" for n, l, _, _, _ in SHAPES))
    name_timings = {}
    failures = []

    for shape_name, shape_limit, shape_note, shape_q, shape_role in SHAPES:
        sql, names = load_sql(shape_name)
        nparams = len(names)
        # 予算は limit ごとに変わる（近傍枠は limit 件ぶん走るため）
        budget = (with_posts + shape_limit) * ROWS_BUDGET_MULTIPLIER

        logger.info("")
        logger.info("=" * 72)
        logger.info("# 形: %s（limit %s） — %s", shape_name, shape_limit, shape_note)
        logger.info("=" * 72)

        for label, lat, lng, radius in CASES:
            failures.extend(
                _measure_case(
                    cur, schema, sql, nparams, names, label, lat, lng, radius,
                    shape_limit, shape_name, budget, full_plan, shape_q, shape_role,
                    name_timings,
                )
            )

    section("3. 判定")
    failures.extend(verdict_name_shapes(name_timings))
    if not failures:
        logger.info(
            "✅ q の無い形は «走る行数が半径に依存しない»、"
            "店名の形は «2 文字が 3 文字と同じ土俵に乗っている» を "
            "custom / generic の両方で保てている"
        )
        return 0
    for f in failures:
        logger.error("❌ %s", f)
    logger.error("")
    logger.error(
        "半径がプランナから見えない書き方へ戻っているか、"
        "測っていない limit の組み合わせが増えている。"
        "api/src/v1/restaurants/restaurants.repository.ts の posted CTE のコメントを読むこと。"
    )
    logger.error(
        "店名の枝（q あり）が赤いときは、2 文字の照合が中間一致へ戻っている。"
        "api/src/v1/restaurants/restaurant-name-match-mode.ts の isSubstringIndexable と "
        "restaurants.repository.ts の buildNameMatch を読むこと。"
        f"そのとき使われるべき索引は {NAME_TRGM_INDEX}（各セルの «使った索引» に出る）。"
    )
    return 1 if do_assert else 0


NAME_TRGM_INDEX = "idx_restaurants_name_trgm"


# ⚠️ **ノードの種類で前置詞が違う。**
#    `Index Scan using X` / `Index Only Scan using X` に対して
#    `Bitmap Index Scan on X` である（PostgreSQL の EXPLAIN の書式）。
#    `using` だけを見ていたら **trgm 索引は必ず Bitmap 経路なので 1 つも拾えず**、
#    未変更の 3 文字の枝まで «索引に乗っていない» と出た（run 34419672593）。
INDEX_NODE = re.compile(
    r"(?:Index Scan|Index Only Scan) using ([A-Za-z0-9_]+)"
    r"|Bitmap Index Scan on ([A-Za-z0-9_]+)"
)


def indexes_used(plan):
    """実行計画が使った索引の名前を、出てきた順に重複なく返す。"""
    seen = []
    for line in plan:
        for m in INDEX_NODE.finditer(line):
            name = m.group(1) or m.group(2)
            if name not in seen:
                seen.append(name)
    return seen


# #1951 店名検索の枝の «速さ» をどう判定するか。
#
# ⚠️ **構造で判定しようとして 3 回外した。dev の実測が全部否定した。**
#
# | 見ようとしたもの | なぜ駄目か（dev run 34418799779 / 34419672593 / 34420435499） |
# | --- | --- |
# | restaurants から読む延べ行数 | 直した形も generic plan では 62 万行と出る（GIST の索引エントリ数）。未変更の 3 文字の枝まで赤くなった |
# | `Seq Scan on restaurants` | **対照群でも一度も出なかった。** プランナは GIST を駆動表に選び、太い行をヒープから読んで name を Filter する |
# | 実行計画に trgm 索引の名前があるか | **対照群の計画にも出る**（19 秒かかっているのに）。索引が計画のどこかに現れることと、店名の照合がそれで絞られていることは別 |
# | 所要 ms の絶対値 | dev は共有 DB でキャッシュも負荷も揺れる。同じ形が 3 ms と 8,117 ms の両方を出す |
#
# 残ったのは**相対比較**である。**同じ run・同じ地点・同じプランモードで、
# «2 文字（直した形）» が «3 文字（未変更の基準）» と同じ土俵に乗っているか**を見る。
# 分母も分子も同じ DB・同じ瞬間なので、キャッシュも負荷も打ち消し合う。
#
# dev 実測（best-of-3。#1951 適用後）:
#
# | 地点 / mode | 2 文字（直した形） | 3 文字（基準） | 対照群（直す前） |
# | --- | ---: | ---: | ---: |
# | 東京駅 20km / custom | 21.0 ms | 18.9 ms | 185.6 ms |
# | 全国 1,500km / generic | 129.1 ms | 117.0 ms | **19,365 ms** |
# | 全国 1,500km / custom | 3.4 ms | 2.9 ms | 1,457.8 ms |
#
# 2 文字は 12 通り全部で 3 文字の **0.97〜1.11 倍**。対照群は **8.8〜436 倍**。
# 閾値 3 倍はこの間のどこにでも引ける。
NAME_SLOWDOWN_LIMIT = 3.0

# ⚠️ **対照群は «基準より十分に遅い» ことが正しい。** そうでなければ、この検査は
#    «直っていない状態を入れても緑» ということなので、番人として機能していない。
#    #1629 / #1686 / #1951 で «空振りを ✅ と読む» を三度やっている。
CONTROL_MIN_SLOWDOWN = 3.0


def verdict_name_shapes(timings):
    """店名の枝を «3 文字の基準に対する倍率» で判定する。失敗の一覧を返す。

    `timings` は `{(role, label, mode): best_ms}`。role は SHAPES の 6 番目の要素。
    best は 3 回のうちの最小（初回のキャッシュ未命中を落とすため）。
    """
    failures = []
    keys = sorted({(k[1], k[2]) for k in timings if k[0] == "baseline"})
    if not keys:
        return ["店名の枝の基準（3 文字）が 1 つも測れていない。SHAPES を確認すること"]
    logger.info("")
    logger.info("## 店名の枝 — 3 文字（未変更の基準）に対する倍率")
    logger.info(
        "   %-38s %-8s %9s %9s %9s", "地点", "mode", "2文字", "3文字", "対照群"
    )
    for label, mode in keys:
        base = timings.get(("baseline", label, mode))
        short = timings.get(("short", label, mode))
        control = timings.get(("control", label, mode))
        if base is None or base <= 0:
            continue
        marks = []
        if short is not None:
            ratio = short / base
            ok = ratio <= NAME_SLOWDOWN_LIMIT
            marks.append(f"2文字 {ratio:.2f}x {'✅' if ok else '❌'}")
            if not ok:
                failures.append(
                    f"店名 2 文字 / {label} / {mode} plan: "
                    f"3 文字の {ratio:.1f} 倍 遅い（上限 {NAME_SLOWDOWN_LIMIT} 倍）。"
                    f"{short:,.1f} ms vs {base:,.1f} ms"
                )
        if control is not None:
            ratio = control / base
            ok = ratio >= CONTROL_MIN_SLOWDOWN
            marks.append(f"対照群 {ratio:.1f}x {'✅' if ok else '❌'}")
            if not ok:
                failures.append(
                    f"対照群（2 文字 × 中間一致）/ {label} / {mode} plan: "
                    f"3 文字の {ratio:.1f} 倍にしかならない（下限 {CONTROL_MIN_SLOWDOWN} 倍）。"
                    f"**検査が空振りしている可能性がある**"
                )
        logger.info(
            "   %-38s %-8s %9.1f %9.1f %9s   %s",
            label[:38],
            mode,
            short if short is not None else -1,
            base,
            f"{control:,.1f}" if control is not None else "-",
            " / ".join(marks),
        )
    return failures


def _measure_case(
    cur, schema, sql, nparams, names, label, lat, lng, radius,
    limit, shape_name, budget, full_plan, q=None, role=None, name_timings=None,
):
    """1 つの «形 × 地点» を custom / generic の両方で測る。戻り値は失敗の一覧。"""
    failures = []
    if True:
        logger.info("")
        logger.info("-" * 72)
        logger.info("## %s", label)
        logger.info("-" * 72)
        params = bind(names, lat, lng, radius, limit, q)
        for generic in (False, True):
            mode = "generic" if generic else "custom "
            cur.execute("SET LOCAL statement_timeout = '120s'")
            # ⚠️ 1 回だけ測ると «初回のキャッシュ未命中» と «構造的に遅い» が区別できない。
            #    同じ文を REPEATS 回まわし、推移を出す（判定には最後の回を使う）。
            runs = []
            timed_out = False
            for _ in range(REPEATS):
                try:
                    plan, t = explain(cur, sql, nparams, params, generic)
                except psycopg2.errors.QueryCanceled:
                    cur.connection.rollback()
                    cur.execute(f'SET search_path TO "{schema}", extensions')
                    logger.info("   %s: ⏱ 120 秒でタイムアウト（= 実用にならない）", mode)
                    failures.append(f"{shape_name} / {label} / {mode}: timeout")
                    timed_out = True
                    break
                runs.append(t)
            if timed_out:
                continue
            ms = runs[-1]["exec"]

            # ⚠️ 丸めの下界だけで判定しない（explain_rows_read.py 冒頭の注記）。
            rows, rows_upper, detail, _ = restaurants_rows_read_with_bound(plan)
            # ⚠️ **custom / generic の両方を判定する。**
            #    #1686 のあと «generic だけ» を見ていたせいで、custom plan が
            #    11〜13 秒のまま «✅» と表示されて見落とした（dev run 33229509189）。
            #    どちらか一方でも半径内を舐めていたら赤にする
            if q is not None:
                # #1951 店名の枝はここでは判定しない。**3 文字の基準との相対比較**で
                #      あとからまとめて判定する（理由は verdict_name_shapes の上の表）。
                #      ここでは «3 回のうちの最良» を記録するだけ。初回のキャッシュ未命中を
                #      落とさないと、dev では同じ形が 3 ms と 8,117 ms の両方を出す。
                best = min(t["exec"] for t in runs if t["exec"] is not None)
                if name_timings is not None and role is not None:
                    name_timings[(role, label, mode.strip())] = best
                verdict = f"  （判定は後段。best {best:,.1f} ms）"
            else:
                state = verdict_against_budget(rows, rows_upper, budget)
                if state == "within":
                    verdict = " ✅"
                elif state == "over":
                    verdict = "  ❌ 半径内の全店を読んでいる"
                    failures.append(
                        f"{shape_name} / {label} / {mode.strip()} plan: "
                        f"restaurants を延べ {rows:,} 行 読んでいる（上限 {budget:,} 行）"
                    )
                else:
                    verdict = f"  ⚠️ 判定できない（丸めの上界 {rows_upper:,} 行 > 上限）"
            logger.info(
                "   %s: %8.1f ms / restaurants から延べ %s 行%s",
                mode,
                ms if ms is not None else -1,
                f"{rows:,}",
                verdict,
            )
            for i, t in enumerate(runs, 1):
                logger.info(
                    "        %d 回目: 実行 %8.1f ms / 計画 %6.1f ms / JIT %s",
                    i,
                    t["exec"] if t["exec"] is not None else -1,
                    t["plan"] if t["plan"] is not None else -1,
                    f'{t["jit"]:.1f} ms' if t["jit"] is not None else "なし",
                )
            if q is not None:
                # ⚠️ 判定の根拠をそのまま出す。«❌ 索引に乗っていない» とだけ言われても
                #    代わりに何が使われたのかが分からないと、次の人がまた EXPLAIN し直す
                logger.info("        使った索引: %s", ", ".join(indexes_used(plan)) or "（なし）")
            for text, n in detail:
                logger.info("        %s  => %s 行", text, f"{n:,}")
            if full_plan:
                for line in plan:
                    logger.info("        %s", line)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default="dev")
    parser.add_argument("--full-plan", action="store_true", help="実行計画を全行出す")
    parser.add_argument(
        "--assert",
        dest="do_assert",
        action="store_true",
        help="遅いプランなら終了コード 1 を返す（ラチェットとして使う）",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("❌ DATABASE_URL environment variable is required")
        return 1

    missing = [
        n
        for n in (
            "search_nearby_restaurants.default.sql",
            "search_nearby_restaurants.default.params.json",
        )
        if not (SQL_DIR / n).exists()
    ]
    if missing:
        logger.error("❌ 計測対象の SQL がない: %s", ", ".join(missing))
        logger.error(
            "   UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "restaurants.order-by-posts-plan  で書き出す"
        )
        return 1

    with psycopg2.connect(database_url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            logger.info(
                "接続先: user=%s db=%s schema=%s",
                one(cur, "SELECT current_user"),
                one(cur, "SELECT current_database()"),
                args.schema,
            )
            with_posts = run_counts(cur, args.schema)
            return run_explain(
                cur, args.schema, with_posts, args.full_plan, args.do_assert
            )


if __name__ == "__main__":
    sys.exit(main())
