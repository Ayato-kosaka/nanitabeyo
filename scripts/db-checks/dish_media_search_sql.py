"""店提案の本体クエリ（`findDishMediaIds`）を «読んで・値を並べる» ための道具立て。

DB 接続を一切持たない純関数だけを置く（psycopg2 を import しないので CI で回せる）。

## SQL はここにも写経しない

本体は `scripts/db-checks/sql/dish_media_search.sql` にある。これは
`api/src/v1/dish-media/dish-media-search-sql.spec.ts` が
**実装の組み立て結果と一致することを機械検査している**自動生成物である。
このモジュールが持つのは «そのファイルの読み方» と «バインド値の並べ方» だけで、
条件も式も 1 つも持たない。

## なぜ切り出したか

`explain_dish_media_search.py`（EXPLAIN する側）と
`measure_search_external_embed_share.py`（実行して数える側）が同じ SQL を読む。
読み方を 2 箇所へ書き写すと、SQL の形が変わったときに片方だけが古い並びで
バインドし、**別のクエリを測って «測れている» と読む**（#1629 で実際に踏んだ形）。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

SQL_DIR = Path(__file__).resolve().parent / "sql"
NAME = "dish_media_search"

SQL_PATH = SQL_DIR / f"{NAME}.sql"
PARAMS_PATH = SQL_DIR / f"{NAME}.params.json"

# 実装側の定数（dish-media.repository.ts の GUMBLE_TAU）。params.json の名前と対応する。
# ⚠️ 値そのものは «ランキングのゆらぎの強さ» であって判定条件ではないので、
#    ここで持っても «判定の写経» にはならない。dish-media-search-sql.spec.ts が
#    書き出し時にこの値を検査している（同 spec の [0.216, 'gumbelTau']）。
GUMBEL_TAU = 0.216

# アプリが投げる既定の件数。Remote Config `v1_search_result_restaurants_number` の
# 既定値（app-expo/lib/remoteConfig.ts の "5"）。
DEFAULT_LIMIT = 5


def knn_candidate_limit(limit: int) -> int:
    """スコアリング前に KNN で残す候補店数。

    正本は api/src/v1/restaurants/nearby-restaurants-cte.ts の `knnCandidateLimit()`。
    後段（dishes / dish_media の JOIN、営業時間の引き上げ）の重さはこの数で頭打ちになる。
    """
    return max(1000, 50 * limit)


def load_search_sql() -> tuple[str, list[str]]:
    """実装が組み立てた SQL とバインド値の «名前の列» を読む。

    バインド位置は半角疑問符なので $1, $2 … へ直す。
    ⚠️ SQL のコメントに半角疑問符が混ざっていると位置がずれる（jest が個数を検査している）。
    """
    missing = [p.name for p in (SQL_PATH, PARAMS_PATH) if not p.exists()]
    if missing:
        raise SystemExit(
            f"❌ 計測対象の SQL がない: {', '.join(missing)}\n"
            "   UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest "
            "dish-media-search-sql  で書き出す"
        )

    raw = SQL_PATH.read_text(encoding="utf-8").rstrip().rstrip(";")
    names = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
    counter = [0]

    def to_positional(_match):
        counter[0] += 1
        return f"${counter[0]}"

    sql = re.sub(r"\?", to_positional, raw)
    if counter[0] != len(names):
        raise SystemExit(
            f"❌ {NAME}: プレースホルダ {counter[0]} 個に対して名前が {len(names)} 個。"
            " UPDATE_RESTAURANT_SQL_SNAPSHOT=1 で書き出し直すこと"
        )
    return sql, names


def bind_search_params(
    names,
    *,
    user_id,
    lat,
    lng,
    radius,
    category_id,
    limit,
    page_seed,
    knn_limit=None,
    gumbel_tau=GUMBEL_TAU,
    closed_restaurant_ids=(),
    open_restaurant_ids=(),
) -> list:
    """バインド値を «名前の列» の順に並べる。

    ⚠️ 手書きの配列にしないこと。SQL の形を変えると順番も変わり、radius と limit が
       入れ替わったまま «別のクエリを測って» 読み違えた実績がある（#1629）。
       同じ名前が複数回出る（lat / lng / radius）ので、必ず名前で引く。
    """
    values = {
        "userId": user_id,
        "lat": lat,
        "lng": lng,
        "radius": radius,
        "categoryId": category_id,
        "limit": limit,
        "knnLimit": knn_candidate_limit(limit) if knn_limit is None else knn_limit,
        "gumbelTau": gumbel_tau,
        "pageSeed": page_seed,
        # timeSlot 未指定と同じ状態（除外も加点も起きない）。
        # 営業時間つきの経路は explain_opening_status.py が別に測る
        "closedRestaurantIds": list(closed_restaurant_ids),
        "openRestaurantIds": list(open_restaurant_ids),
    }
    unknown = sorted(set(names) - set(values))
    if unknown:
        raise SystemExit(
            f"❌ {NAME}.params.json に知らないバインド名がある: {', '.join(unknown)}。"
            " SQL の形が変わっている。bind_search_params を直すこと"
        )
    return [values[n] for n in names]
