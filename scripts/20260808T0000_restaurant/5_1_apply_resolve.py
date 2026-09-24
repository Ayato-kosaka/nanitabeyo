#!/usr/bin/env python3
"""#1273 sns_post_raw の各 URL を resolve API に通し、結果を sns_post_resolved へ入れる。

**resolve が単一頭脳。** ここは URL（と分かる時だけエリア座標）を渡し、返ってきた prefill から
google_place_id / dish_category_id を取り出して status を決めるだけ。照合ロジックは一切持たない。
認証は自己署名 JWT（common_sns。匿名サインインは使わない）。

resolve は dev API を叩くので負荷を考え --limit でバッチ分割し、間隔を空ける。
同一 run の再処理は post_id 単位で入れ直す（batch 冪等）。resolve 改善後の再処理は
--resolve-version を変えて未処理分だけ流す運用にできる。
"""

from __future__ import annotations

import argparse
import logging
import os
import time
import urllib.error

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (
    PROVIDER_INSTAGRAM,
    RUN_ID_ALL,
    run_id_arg_help,
    run_id_filter_sql,
    posts_with_category_sql,
    TABLE_POST_RAW,
    TABLE_POST_RESOLVED,
    ResolveClient,
    classify,
)

LOGGER = logging.getLogger(__name__)
DEFAULT_AREA_RADIUS_M = 3000
# #1947 `--max-minutes` を確かめる間隔（投稿数）。1 バッチ（--limit）を丸ごと回し切って
# から締め切りを見ると、遅いときに何時間も超過する。200 件なら遅い日（3,400 投稿/時）でも
# 3.5 分以内に必ず締め切りを見る。
DEADLINE_CHECK_EVERY = 200


def first_time_share_sql(table: str) -> str:
    """この run が解いた投稿のうち «どこにも結果が無かった＝初めて解いた» 数を返す SQL。

    #1947 これが無いと «毎ラウンドがゼロから全投稿を解き直している» のが外から見えない。
    2026-09-21〜24 の 3.5 日、書いた 4,626,900 行のうち初回は 256,078 行（5.5%）だったが、
    ログには «N 件を投入しました» としか出ておらず、**4 日間だれも気づけなかった**。
    速度ではなく «仕事になっている割合» を出す。
    """
    return f"""
    WITH mine AS (
      SELECT DISTINCT post_id FROM `{table}`
      WHERE run_id = @rid AND resolve_version = @ver AND post_id IS NOT NULL
    ),
    others AS (
      SELECT DISTINCT post_id FROM `{table}`
      WHERE (run_id != @rid OR resolve_version != @ver) AND post_id IS NOT NULL
    )
    SELECT COUNT(*) AS posts,
           COUNTIF(o.post_id IS NULL) AS first_time
    FROM mine m LEFT JOIN others o USING (post_id)
    """


def deadline_chunks(batch: list, deadline: float, *,
                    chunk: int = DEADLINE_CHECK_EVERY, now=time.monotonic):
    """`batch` を `chunk` 件ずつ返す。**1 塊ごとに締め切りを見て、越えていたら止める。**

    #1947 ここを «1 バッチ回し切ってから締め切りを見る» に戻さないこと。
    `--limit` は 20,000 件で、resolve が遅い日（実測 3,400 投稿/時）は 1 バッチが
    約 6 時間になる。締め切りをバッチの外でしか見ないと `--max-minutes 270` の run が
    310 分を越えても止まれず、**GitHub の 360 分打ち切り**に当たる
    （2026-09-22 に 361 分ちょうどで cancelled され、5.5 時間ぶんの集計を失っている）。

    止めた残りは未 resolve のまま残るので、次の run が拾う（取りこぼしにはならない）。

    `deadline` が 0 のときは «締め切り無し» として全部返す。
    """
    for i in range(0, len(batch), max(chunk, 1)):
        if deadline and now() >= deadline:
            return
        yield i, batch[i:i + max(chunk, 1)]


# #1273 【設計】resolve のスループットを «推測で語らない» ための計測。
# 1 投稿の所要時間は «resolve API の往復» が支配的だが、その中身（IG 取得する/しない・
# エリア検索する/しない）で桁が違う。どの条件が何 ms なのかを **run 自身が数えて**
# ジョブログへ出す。集計の分母は «その条件に該当した投稿数» で、母数ごと必ず併記する。
class Timings:
    """条件ごとの所要時間サンプルを溜め、p50/p90 と件数で報告する。thread-safe。"""

    def __init__(self) -> None:
        import threading
        self._lock = threading.Lock()
        self.samples: dict[str, list[float]] = {}

    def add(self, key: str, seconds: float) -> None:
        with self._lock:
            self.samples.setdefault(key, []).append(seconds)

    @staticmethod
    def _pct(xs: list[float], q: float) -> float:
        if not xs:
            return 0.0
        ys = sorted(xs)
        i = min(len(ys) - 1, max(0, int(round(q * (len(ys) - 1)))))
        return ys[i]

    def report(self, title: str) -> None:
        with self._lock:
            keys = sorted(self.samples)
        LOGGER.info("=== %s ===", title)
        LOGGER.info("%-34s %7s %9s %9s %9s %9s", "条件", "件数", "平均ms", "p50ms", "p90ms", "合計s")
        for k in keys:
            xs = self.samples[k]
            LOGGER.info("%-34s %7d %9.0f %9.0f %9.0f %9.1f", k, len(xs),
                        1000 * sum(xs) / len(xs), 1000 * self._pct(xs, 0.5),
                        1000 * self._pct(xs, 0.9), sum(xs))


def _cond_key(post, resp) -> str:
    """1 投稿の «条件» を 1 本の文字列にする（caption 有無 × エリア有無 × 検索が走ったか）。"""
    cap = "cap" if (post.get("caption") or "").strip() else "nocap"
    area = "area" if post["discovery_area_lat"] is not None else "noarea"
    if resp is None:
        return f"{cap}/{area}/ERROR"
    d = resp.get("data") if isinstance(resp.get("data"), dict) else resp
    rs = (d or {}).get("restaurantSearch") or {}
    if rs.get("performed"):
        tail = "search"
    else:
        tail = "no_search:" + str(rs.get("reason") or (d or {}).get("reason") or "?")
    return f"{cap}/{area}/{tail}"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="sns_post_raw を resolve に通して sns_post_resolved を作る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--raw-run-id", default=None,
                   help=run_id_arg_help(
                       "読む «収集» の run_id（sns_post_raw.run_id。省略時は --run-id）"))
    p.add_argument("--resolve-version", default="dev", help="この resolve デプロイの識別（再処理管理用）")
    p.add_argument("--limit", type=int, default=500, help="このバッチで処理する未処理投稿数の上限")
    p.add_argument("--sleep-ms", type=int, default=150, help="resolve 呼び出しの間隔（--concurrency 1 のときだけ効く。dev API 負荷対策）")
    # #1273 【設計】**並列度の上限は dev API ではなく DB の接続数で決まる。**
    # 実測 2026-09-05（`nanitabeyo_logs_dev.run_googleapis_com_stdout`）:
    #
    # | 全ワーカー合計の同時リクエスト | 1 投稿 p50 | 実効スループット | backend error |
    # | --- | --- | --- | --- |
    # | 1  | 227ms | 3.6 投稿/秒 | 0 |
    # | 4  | 220ms | 15.8 投稿/秒 | 0 |
    # | 8  | 274ms（keep-alive 前）/ 159ms（後） | 24.9〜26.3 投稿/秒 | 0 |
    # | 17 | — | — | 0（15 分） |
    # | 24 | — | — | **82 件/分** |
    #
    # 24 で出た error は全部 `EMAXCONNSESSION: max clients reached in session mode
    # - pool_size: 15` ＝ **Supabase プーラの接続上限**。API 側は DB_POOL_MAX=5 ×
    # Cloud Run max-instances 8 なので、投げ過ぎると自分で自分の DB を塞げる。
    # **1 本のワーカーで 8、同時に走らせるワーカーは 2 本まで**（合計 16）を上限にする。
    #
    # #1273 大量並列: caption を持つ投稿は resolve が IG を叩かない（純テキスト処理）ので
    # 好きなだけ並列できる。ThreadPoolExecutor で --concurrency 本を同時に走らせる。
    # ⚠️ caption を «持たない» 投稿は resolve が IG を取りに行く＝並列すると IG レート制限
    # （実測 73% 失敗）。その場合は --concurrency 1 に落とすこと（既定 1＝従来どおり直列）。
    p.add_argument("--concurrency", type=int, default=1,
                   help="同時 resolve 数。caption 付き投稿(IG非取得)なら大きく。未取得経路は 1 のまま。"
                        "⚠️ **全ワーカーの合計で 16 を超えないこと**（下記の実測）")
    p.add_argument("--resolve-retries", type=int, default=2,
                   help="429 / 5xx を投げ直す回数。0 で投げ直さない")
    p.add_argument("--debug-dump", type=int, default=0, help="先頭 N 件の resolve 生レスポンスをログに出す（診断用）")
    # 18k+ の再 resolve を数時間で終えるため、post_id ハッシュで水平分割して複数 run を並列に回す。
    # 各シャードは互いに素な post_id 集合を担当するので二重 resolve/二重挿入が起きない。
    p.add_argument("--shards", type=int, default=1, help="並列シャード総数（既定1=分割なし）")
    p.add_argument("--shard", type=int, default=0, help="このバッチが担当するシャード番号 [0, shards)")
    # 再解決を «非破壊» のパイプライン一級操作にする（delete 不要）。resolve 改善後は
    # --resolve-version を上げて回すと、同 version で未処理の投稿だけを追記解決する。
    # 集計側は post ごとの «最新 resolve_version» を見る（7_1 / 測定クエリ）。
    # #1812 CC WAT 経路: caption 付き投稿が桁で増えたので、resolve へ回す前に caption で絞れるようにする。
    # 何を «飲食» と見なすかは経路ごとに違うので、正規表現は dispatch 側で指定する（コードに埋めない）。
    p.add_argument("--caption-regexp", default=None,
                   help="caption がこの正規表現に一致する投稿だけ resolve する（RE2）")
    # 4_11 で地点を後埋めした投稿だけを狙って解き直すためのもの。地点の付いていない投稿を
    # 一緒に流しても、前回と同じ答えしか返らない。
    # #1812 収集ジョブが数時間走り続けるので、1 回の dispatch で «その時点の未処理» だけを
    # 片付けても、終わった頃には新しい投稿が積み上がっている。取り切るまで繰り返す。
    p.add_argument("--max-minutes", type=int, default=0,
                   help="0 より大きいと、未処理が無くなるかこの時間まで取得と resolve を繰り返す")
    p.add_argument("--idle-sleep-s", type=int, default=120,
                   help="未処理が無かったときに次を見に行くまでの待ち時間")
    p.add_argument("--area-radius-m", type=int, default=DEFAULT_AREA_RADIUS_M,
                   help="lat/lng と一緒に渡す検索半径（m）。市区町村の重心を地点にしている経路では "
                        "3km だと届かない（実測: 重心から店までの中央値 7,253m）")
    p.add_argument("--post-ids", default=None,
                   help="この post_id（カンマ区切り）だけを解き直す。原因調査で --debug-dump と併用する")
    p.add_argument("--only-with-area", action="store_true",
                   help="discovery_area_lat/lng を持つ投稿だけ resolve する")
    p.add_argument("--only-without-area", action="store_true",
                   help="**地点が無い**投稿だけを対象にする（#1841 の «位置情報なしで 📍店名 から引けるか» の計測用）")
    p.add_argument("--reresolve-prev-status", default=None,
                   help="この «直近 version の status» の投稿だけ再解決する（例 skipped_no_store）。省略時は全未処理")
    # #1273 «未処理» の定義を «この run_id × この version で未処理» から «どこにも結果が無い» へ広げる。
    # 同じ post_id が複数の収集 run に入る（cc_wat は ccwat2〜5 で重なる）ので、run 単位の
    # anti-join だけだと **既に別 run で解けている投稿をもう一度 resolve へ投げる**。
    # 実測 2026-09-05: 未処理 99,937 投稿に対し run 単位で数えると 118,283（1.18 倍）。
    # 解き直しを狙うときは付けない（付けると «結果があるもの» は全部飛ぶ）。
    # 接続の張り直しが 1 投稿の所要時間のどれだけを占めるかを測る/戻すためのつまみ。
    # BigQuery の load job は «1 回あたり» の固定待ちが大きい（実測 200 行でも 1000 行でも
    # 約 4.6 秒）。並列度を上げると 200 行はすぐ溜まるので、回数が増えるぶんだけ無駄になる。
    p.add_argument("--flush-every", type=int, default=0,
                   help="何件ごとに sns_post_resolved へロードするか。0 なら concurrency から自動（200×並列度、上限 2000）")
    p.add_argument("--no-keep-alive", action="store_true",
                   help="resolve への HTTPS 接続を毎回張り直す（従来動作。keep-alive の効果測定用）")
    # caption 後埋め（4_14）→ 解き直しの «対象» を決める。配信カタログは
    # dish_category_id が付いた投稿しか使わないので、後埋めで取り返せるのは
    # «いまカテゴリが付いていない投稿» だけ。既にカテゴリがある投稿（C 群 34,859）を
    # 巻き込むと、同じ答えを出し直すだけで時間を使う。
    #
    # ⚠️ #1947【設計】**«カテゴリを取り返す» 目的のときだけ付けること。**
    # «解き直し全般» の既定にしてはいけない。2026-09-21 に 1 時間ぶんを実測した:
    #
    # | 解き直した投稿 | 件数 | カテゴリ獲得 | **店獲得** |
    # | --- | ---: | ---: | ---: |
    # | もともとカテゴリ無し | 55,932 | 1,729 | 182 |
    # | **もともとカテゴリ有り** | 90,095 | 0（当然） | **586** |
    #
    # 既にカテゴリがある投稿の解き直しは «同じ答えを出し直すだけ» ではない。
    # **店の照合はカテゴリと独立に改善する**（seed の後貼り・キャプション後埋め・
    # 店名辞書の更新が効く）ので、このフラグを常用すると **店獲得の 76% を捨てる**。
    p.add_argument("--only-without-category", action="store_true",
                   help="いま（最新の resolve で）料理カテゴリが付いていない投稿だけを対象にする")
    # #1947 【設計】積み残しを消すラウンドでは **必ず付ける**。
    #
    # «未処理» の定義は «この resolve run_id × この resolve_version で未処理»（下の
    # `_fetch_unresolved` の anti-join）。運用ではラウンドごとに新しい run_id を付けるので、
    # 付けないと **毎回ゼロから全投稿を解き直す**。2026-09-24 00:00〜03:30 の実測:
    #
    # | | 投稿 | matched | matched/投稿 |
    # | --- | ---: | ---: | ---: |
    # | **初めて解いた** | 3,952 | **289** | **0.0731** |
    # | 解き直した | 74,414 | +125 −78 +4 = **+51**（差し引き） | **0.00069** |
    #
    # **初回は解き直しの約 106 倍**。この日は書いた行 78,366 のうち初回が 5.0% しかなく、
    # 未処理は 184,529 → 207,403 と**増えていた**（収集が約 10,800 投稿/時で積み増すのに対し、
    # 実効の消化は約 2,000 投稿/時しか無かった）。
    #
    # ⚠️ 解き直しに価値が無いという意味ではない。**resolve や店名辞書を改善した直後**は
    #    解き直しが効く（2026-09-21 の実測では店獲得の 76% が解き直しから出た）。
    #    そのときは «改善したので全部解き直す» と決めて `--resolve-version` を上げること。
    #    **既定で毎回全部解き直すのが誤り**である。
    p.add_argument("--skip-resolved-anywhere", action="store_true",
                   help="他の run_id / resolve_version で既に結果がある投稿を対象から外す"
                        "（積み残しの一括処理では必ず付ける。付けないと毎回ゼロから解き直す）")
    return p.parse_args()


def _fetch_unresolved(pipeline: BigQueryPipeline, raw_run_id: str, resolve_run_id: str,
                      resolve_version: str, limit: int, shards: int = 1, shard: int = 0,
                      reresolve_prev_status: str | None = None, caption_regexp: str | None = None,
                      only_with_area: bool = False, post_ids: list[str] | None = None,
                      only_without_area: bool = False, skip_resolved_anywhere: bool = False,
                      only_without_category: bool = False):
    """未 resolve（この run × **この resolve_version** で未処理）の投稿を取り出す。

    version を anti-join に含めるので、--resolve-version を上げると全投稿が «その version では未処理»
    となり再解決＝追記（既存 version の行は消さない＝非破壊）。shards>1 は post_id で水平分割。
    reresolve_prev_status を渡すと «直近 version の status がそれ» の投稿だけに絞る（狙い撃ち再解決）。
    """
    from google.cloud import bigquery
    shard_filter = ""
    if shards > 1:
        # FARM_FINGERPRINT は決定的なので、同じ post_id は常に同じシャードに落ちる（並列非重複）。
        shard_filter = "AND MOD(ABS(FARM_FINGERPRINT(r.post_id)), @shards) = @shard"
    area_filter = "AND r.discovery_area_lat IS NOT NULL" if only_with_area else ""
    # #1841 «位置情報を渡さないとき 📍店名 だけで店に届くか» を測るための逆フィルタ。
    if only_without_area:
        area_filter = "AND r.discovery_area_lat IS NULL"
    # 特定の投稿だけを解き直す（原因調査用）。--debug-dump と併せて生レスポンスを見る。
    ids_filter = "AND r.post_id IN UNNEST(@post_ids)" if post_ids else ""
    # «どこかに結果がある» 投稿を丸ごと外す。run をまたいだ二重 resolve を止めるためのもの。
    # «いまカテゴリが付いている» の判定は common_sns が唯一の正（写経しない）。
    no_category_filter = ""
    if only_without_category:
        no_category_filter = (
            f"AND r.post_id NOT IN ({posts_with_category_sql(pipeline.table(TABLE_POST_RESOLVED))})")
    anywhere_filter = ""
    if skip_resolved_anywhere:
        anywhere_filter = (
            f"AND r.post_id NOT IN (SELECT post_id FROM `{pipeline.table(TABLE_POST_RESOLVED)}` "
            "WHERE post_id IS NOT NULL)"
        )
    caption_filter = ""
    if caption_regexp:
        caption_filter = "AND r.caption IS NOT NULL AND REGEXP_CONTAINS(r.caption, @caprx)"
    prev_filter = ""
    if reresolve_prev_status:
        # 直近 version（resolved_at 最新）の status が指定値の post_id に限定する。
        prev_filter = f"""
      AND r.post_id IN (
        SELECT post_id FROM (
          SELECT post_id, status,
                 ROW_NUMBER() OVER (PARTITION BY provider, post_id ORDER BY resolved_at DESC) rn
          FROM `{pipeline.table(TABLE_POST_RESOLVED)}`
          WHERE run_id = @resolve_rid
        ) WHERE rn = 1 AND status = @prev_status
      )"""
    # #1947: 溜まった未 resolve は **複数の収集 run にまたがる**（2026-09-20 に 212,301 件）。
    # 判定は common_sns が唯一の正（同じ分岐を各 script へ写経しない）。
    raw_run_filter = run_id_filter_sql("r.run_id", "@raw_rid", raw_run_id)
    sql = f"""
      SELECT r.post_id, r.canonical_url, r.discovery_route,
             r.discovery_area_lat, r.discovery_area_lng,
             r.caption, r.author_name
      FROM `{pipeline.table(TABLE_POST_RAW)}` r
      LEFT JOIN `{pipeline.table(TABLE_POST_RESOLVED)}` v
        ON v.run_id = @resolve_rid AND v.provider = r.provider AND v.post_id = r.post_id
           AND v.resolve_version = @resolve_version
      WHERE {raw_run_filter} AND v.post_id IS NULL {shard_filter} {prev_filter} {caption_filter} {area_filter} {ids_filter} {anywhere_filter} {no_category_filter}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY r.post_id ORDER BY r.fetched_at DESC) = 1
      LIMIT {int(limit)}
    """
    params = [
        bigquery.ScalarQueryParameter("raw_rid", "STRING", raw_run_id),
        bigquery.ScalarQueryParameter("resolve_rid", "STRING", resolve_run_id),
        bigquery.ScalarQueryParameter("resolve_version", "STRING", resolve_version),
    ]
    if shards > 1:
        params.append(bigquery.ScalarQueryParameter("shards", "INT64", shards))
        params.append(bigquery.ScalarQueryParameter("shard", "INT64", shard))
    if post_ids:
        params.append(bigquery.ArrayQueryParameter("post_ids", "STRING", post_ids))
    if reresolve_prev_status:
        params.append(bigquery.ScalarQueryParameter("prev_status", "STRING", reresolve_prev_status))
    if caption_regexp:
        params.append(bigquery.ScalarQueryParameter("caprx", "STRING", caption_regexp))
    return list(pipeline.execute(sql, params))


def _raw_run_has_any_post(pipeline: BigQueryPipeline, raw_run_id: str) -> bool:
    """その収集 run に投稿が «1 件でも» あるか。

    «未 resolve が 0» が «追いついた» なのか «run_id を間違えた» なのかを分ける唯一の判定。
    """
    from google.cloud import bigquery  # noqa: PLC0415  認証があるときだけ読む
    where = run_id_filter_sql("run_id", "@raw_rid", raw_run_id)
    sql = f"SELECT COUNT(*) AS n FROM `{pipeline.table(TABLE_POST_RAW)}` WHERE {where} LIMIT 1"
    params = [bigquery.ScalarQueryParameter("raw_rid", "STRING", raw_run_id)]
    for row in pipeline.execute(sql, params):
        return bool(dict(row)["n"])
    return False


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    raw_run_id = args.raw_run_id or run_id
    pipeline = BigQueryPipeline()
    client = ResolveClient(keep_alive=not args.no_keep_alive,
                           retries=args.resolve_retries)  # base_url は common_sns の BACKEND_BASE_URL
    sleep_s = max(args.sleep_ms, 0) / 1000.0
    timings = Timings()
    bq = Timings()

    def fetch() -> list:
        t0 = time.perf_counter()
        try:
            return _fetch_unresolved(pipeline, raw_run_id, run_id, args.resolve_version, args.limit,
                                     args.shards, args.shard, args.reresolve_prev_status,
                                     args.caption_regexp, args.only_with_area,
                                     [x.strip() for x in (args.post_ids or "").split(",") if x.strip()] or None,
                                     args.only_without_area, args.skip_resolved_anywhere,
                                     args.only_without_category)
        finally:
            bq.add("BQ:未処理の取り出し(1回)", time.perf_counter() - t0)

    t_start = time.monotonic()
    deadline = time.monotonic() + args.max_minutes * 60 if args.max_minutes > 0 else 0.0
    posts = fetch()
    LOGGER.info("未 resolve %d 投稿を処理します（resolve_version=%s, shard=%d/%d, 狙い撃ち=%s）",
                len(posts), args.resolve_version, args.shard, args.shards,
                args.reresolve_prev_status or "全未処理")

    with pipeline.step(run_id, "5_1_apply_resolve", parameters={
        "raw_run_id": raw_run_id, "resolve_version": args.resolve_version, "limit": args.limit,
        "shards": args.shards, "shard": args.shard,
    }, repo_root=None) as result:
        # 数千件の resolve は 1〜2h かかる。末尾一括ロードだと進捗が見えず timeout で全ロストするので
        # FLUSH_EVERY 件ごとに逐次ロードする（WRITE_APPEND。再実行時は resolved 済みを LEFT JOIN でskip）。
        # 既定は並列度に合わせる。直列（concurrency=1）のときは従来どおり 200 のまま。
        FLUSH_EVERY = args.flush_every if args.flush_every > 0 else min(200 * max(args.concurrency, 1), 2000)
        rows: list[dict] = []
        n_ok = n_err = 0
        dumped = 0
        total = 0
        matched = 0

        def _flush() -> None:
            nonlocal rows, total
            if rows:
                t0 = time.perf_counter()
                n = len(rows)
                total += pipeline.load_json_rows(TABLE_POST_RESOLVED, rows)
                bq.add(f"BQ:sns_post_resolved へロード({n}行/回)", time.perf_counter() - t0)
                rows = []

        def _resolve_one(post):
            """1 投稿を resolve。caption があれば渡す→resolve は IG を取りに行かない。
            戻り値 (post, resp) / 失敗時 (post, None)。HTTP だけを行うので thread-safe。"""
            lat = post["discovery_area_lat"]
            lng = post["discovery_area_lng"]
            radius = args.area_radius_m if (lat is not None and lng is not None) else None
            t0 = time.perf_counter()
            try:
                resp = client.resolve_raw(
                    post["canonical_url"], lat=lat, lng=lng, radius=radius,
                    caption=post.get("caption"), author_name=post.get("author_name"),
                )
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                # resolve 到達不可・タイムアウト等はこの投稿を «未処理» のまま残す（行を作らない）
                timings.add(_cond_key(post, None), time.perf_counter() - t0)
                LOGGER.warning("resolve 失敗 post_id=%s: %s", post["post_id"], str(e)[:160])
                return (post, None)
            timings.add(_cond_key(post, resp), time.perf_counter() - t0)
            return (post, resp)

        def _handle(post, resp) -> None:
            """resolve 結果を集約する。**メインスレッドだけが呼ぶ**ので lock 不要。"""
            nonlocal n_ok, n_err, dumped, matched
            if resp is None:
                n_err += 1
                return
            if dumped < args.debug_dump:
                import json as _json
                LOGGER.info("[debug] url=%s\n%s", post["canonical_url"],
                            _json.dumps(resp, ensure_ascii=False)[:1500])
                dumped += 1
            outcome = classify(resp)
            n_ok += 1
            rows.append({
                "post_id": post["post_id"], "provider": PROVIDER_INSTAGRAM,
                "status": outcome.status,
                "google_place_id": outcome.google_place_id,
                "dish_category_id": outcome.dish_category_id,
                "restaurant_confidence": outcome.restaurant_confidence,
                "category_confidence": outcome.category_confidence,
                "resolve_reason": outcome.resolve_reason,
                "resolve_version": args.resolve_version,
                # ⚠️ #1947 **run の開始時刻を使い回さない。** 2026-09-21 まで run の先頭で
                # 1 度だけ取った値を全行へ入れており、5.5 時間の run の全 65 万行が同じ
                # 時刻になっていた。実害は 2 つ:
                #   1. `LATEST_RESOLVED_QUALIFY` は «その投稿の現在の正» を
                #      `resolved_at DESC` で決める。run 単位の時刻だと、**後から出した
                #      結果より、先に始まった別 run の古い結果が勝つ**ことがある
                #      （同じ shard を跨いで走った e-run と f-run で実際に重なっていた）。
                #   2. «1 時間あたりどれだけ解けたか» が表から測れない。進み方が測れないと
                #      «間に合うか» に答えられない（実際にこの測定ができず詰まった）。
                "resolved_at": utc_now().isoformat(), "run_id": run_id,
            })
            if outcome.status == "matched":
                matched += 1
            if len(rows) >= FLUSH_EVERY:
                _flush()
                LOGGER.info("  … %d/%d 処理・%d 件ロード済み（matched=%d, 失敗=%d）",
                            n_ok + n_err, len(posts), total, matched, n_err)

        concurrency = max(args.concurrency, 1)

        def run_batch(batch: list) -> None:
            # #1947 【設計】`--max-minutes` を **バッチの中でも**見る。
            #
            # 以前は締め切りを «バッチとバッチの間» でしか見ていなかった。1 バッチは
            # `--limit` 件（運用では 20,000 件）なので、**resolve が遅くなるとそのまま
            # 締め切りを何時間も越える**。2026-09-23 に dev の DB が詰まって
            # 3,400 投稿/時まで落ちたとき、1 バッチの所要が約 6 時間になり、
            # `--max-minutes 270` の run が 310 分を越えても止まれなかった
            # （GitHub の 1 job 上限は 360 分。過去に 361 分ちょうどで cancelled され、
            #   5.5 時間ぶんの集計を失っている）。
            #
            # ⚠️ ここで «バッチを小さくする» 方向に直さないこと。バッチの大きさは
            #    «BigQuery から未処理を取り出す回数»（1 回 37 秒）とのトレードオフで
            #    決まっている。**締め切りの見方**だけを直す。
            #    途中で止めた残りは未 resolve のまま残るので、次の run が拾う。
            done = 0
            for i, chunk in deadline_chunks(batch, deadline):
                done = i + len(chunk)
                if concurrency == 1:
                    # 直列（従来どおり）。caption 無し＝IG 取得経路はここで回す（並列 IG はレート制限）。
                    for post in chunk:
                        _handle(*_resolve_one(post))
                        if sleep_s:
                            time.sleep(sleep_s)
                else:
                    # 大量並列。caption 付き（IG 非取得）でだけ concurrency を上げること。
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
                        futs = [ex.submit(_resolve_one, post) for post in chunk]
                        for fut in concurrent.futures.as_completed(futs):
                            _handle(*fut.result())
            if done < len(batch):
                LOGGER.info("締め切り（--max-minutes %d）に達したので、このバッチの残り "
                            "%d 件は次の run へ回します", args.max_minutes, len(batch) - done)

        run_batch(posts)
        # ⚠️ 2026-09-20: `--raw-run-id` を渡し忘れて «resolve 側の run_id» が入り、
        # 対象 0 件のまま 2 シャードが 1 時間アイドルした。
        #
        # ただし «0 件» には **意味の違う 2 つ**がある。最初の版はこれを区別せず、
        # **追いついているだけの正常な run まで exit 1 で赤くしていた**（同日 20:30）。
        # 赤が常態になると、本物の失敗が埋もれる。
        #
        # | 収集 run に投稿が | 未 resolve が | 意味 | どうする |
        # | --- | --- | --- | --- |
        # | **無い** | 0 | run_id の**指定間違い** | 落ちる |
        # | ある | 0 | **追いついた** | 正常終了 |
        if not posts and total == 0:
            if _raw_run_has_any_post(pipeline, raw_run_id):
                LOGGER.info(
                    "収集 run %r に未 resolve の投稿は 1 件も無い（追いついている）。正常終了する。",
                    raw_run_id)
                result["row_count"] = 0
                return
            raise SystemExit(
                f"収集 run {raw_run_id!r} に投稿が 1 件も無い。"
                f"`--raw-run-id` は «収集（sns_post_raw）» の run_id を渡すところで、"
                f"省略すると `--run-id`（{run_id!r}）が使われる。"
                f"複数 run をまとめて掃くときは `%` を含むパターンか "
                f"`{RUN_ID_ALL}` を渡すこと。")
        while deadline and time.monotonic() < deadline:
            _flush()
            posts = fetch()
            if not posts:
                LOGGER.info("未処理なし。%d 秒待って見直します（残り %.0f 分）",
                            args.idle_sleep_s, (deadline - time.monotonic()) / 60)
                time.sleep(args.idle_sleep_s)
                continue
            LOGGER.info("追加の未 resolve %d 投稿（累計 %d 件ロード済み）", len(posts), total)
            n_ok = n_err = 0
            run_batch(posts)

        _flush()
        result["row_count"] = total
        elapsed = time.monotonic() - t_start
        timings.report(f"1 投稿あたりの resolve 所要時間（concurrency={concurrency}）")
        bq.report("BigQuery の待ち時間")
        LOGGER.info("実効スループット: %d 件 / %.1f 秒 = **%.2f 投稿/秒**（= %.0f 投稿/時, concurrency=%d, shard=%d/%d）",
                    total, elapsed, total / elapsed if elapsed else 0.0,
                    3600 * total / elapsed if elapsed else 0.0, concurrency, args.shard, args.shards)
        LOGGER.info("sns_post_resolved に %d 件（matched=%d, resolve失敗=%d, 429/5xx の投げ直し=%d 回）を投入しました",
                    total, matched, n_err, client.retried)
        _report_first_time_share(pipeline, run_id, args)


def _report_first_time_share(pipeline: BigQueryPipeline, run_id: str, args) -> None:
    """«この run の仕事のうち、何割が初めて解いた投稿か» をログへ出す。

    ⚠️ 落とさない・赤くしない。**意図した解き直し**（resolve を改善したので全部やり直す）
    では 0% が正しい。ここは «気づけない» をなくすためのものであって、門ではない。
    """
    from google.cloud import bigquery  # noqa: PLC0415
    try:
        rows = [dict(r) for r in pipeline.execute(
            first_time_share_sql(pipeline.table(TABLE_POST_RESOLVED)), [
                bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                bigquery.ScalarQueryParameter("ver", "STRING", args.resolve_version),
            ])]
    except Exception as exc:  # noqa: BLE001
        LOGGER.info("初回割合の集計に失敗（本体の結果には影響しない）: %s", exc)
        return
    if not rows or not rows[0].get("posts"):
        return
    posts = int(rows[0]["posts"])
    first = int(rows[0].get("first_time") or 0)
    pct = 100.0 * first / posts
    LOGGER.info("この run が解いた %d 投稿のうち «初めて解いた» のは **%d（%.1f%%）**",
                posts, first, pct)
    if pct < 50.0 and not args.skip_resolved_anywhere:
        LOGGER.warning(
            "⚠️ 仕事の %.1f%% が «すでに解いた投稿の解き直し» です。積み残しを消すつもりなら "
            "`--skip-resolved-anywhere` を付けてください（«未処理» の定義は «この run_id × "
            "この resolve_version で未処理» なので、ラウンドごとに run_id を変えると毎回 "
            "ゼロから解き直します）。**意図した解き直しなら、この警告は正しい状態です。**",
            100.0 - pct)


if __name__ == "__main__":
    main()
