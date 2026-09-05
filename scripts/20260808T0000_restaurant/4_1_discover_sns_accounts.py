#!/usr/bin/env python3
"""#1273 収集ルート1/2: SNS 収集元アカウントを sns_source_account へ入れる。

--source で 3 経路（外部 API 不要・無料）:
  influencer_list    … グルメインフルエンサーの handle 一覧（seed ファイル）を取り込む（ルート2）
  open_data_socials  … restaurant_catalog.social_urls の instagram を店アカウントとして取り込む（ルート1）
  official_site_crawl… 4_4 が作った sns_store_site_ig（店公式サイト crawl の店固有 IG）を合流（柱1）
  caption_mentions   … 収集済み投稿の caption 中の @mention を新しいアカウントとして取り込む（柱2の自己増殖）
  embedded_authors   … 埋め込み経路で採れた投稿の投稿者 handle を新しいアカウントとして取り込む

いずれも「アカウントを見つける」だけ。投稿の収集は 4_2、店舗照合は resolve（このスクリプトはしない）。
SERPER でハンドルを探すルート1の補完（serper_account）は 4_1b で別途。
"""

from __future__ import annotations

import argparse
import logging
import re
from datetime import date
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_SOURCE_ACCOUNT, TABLE_STORE_SITE_IG

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

# instagram.com/<handle> からハンドルを取り出す。投稿・機能パスは除外する。
_IG_HANDLE_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]+)", re.IGNORECASE)
_NON_ACCOUNT = {
    "p", "reel", "reels", "tv", "explore", "stories", "s", "accounts",
    "about", "developer", "legal", "directory",
}


def _extract_handle(url: str) -> str | None:
    m = _IG_HANDLE_RE.search(url or "")
    if not m:
        return None
    handle = m.group(1).strip(".").lower()
    if not handle or handle in _NON_ACCOUNT:
        return None
    return handle


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SNS 収集元アカウントを収集する（ルート1/2）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--source", required=True,
                   choices=["influencer_list", "open_data_socials", "official_site_crawl",
                            "caption_mentions", "embedded_authors"])
    p.add_argument("--handles-file", default=str(HERE / "sns_influencer_seed_handles.txt"),
                   help="influencer_list 用。1 行 1 handle")
    p.add_argument("--catalog-run-id", default=None,
                   help="open_data_socials 用。読む restaurant_catalog の run_id（省略時は最新）")
    p.add_argument("--crawl-run-id", default=None,
                   help="official_site_crawl 用。読む sns_store_site_ig の run_id（省略時は --run-id と同じ）")
    p.add_argument("--limit", type=int, default=None, help="open_data_socials の上限（動作確認用）")
    p.add_argument("--caption-run-ids", default=None,
                   help="caption_mentions 用。caption を読む sns_post_raw の run_id をカンマ区切りで（省略時は全 run）")
    p.add_argument("--min-posters", type=int, default=1,
                   help="caption_mentions 用。何人の異なる投稿者に言及された handle を採るか")
    p.add_argument("--min-posts", type=int, default=1,
                   help="embedded_authors 用。埋め込みで何件の投稿が採れた handle を採るか")
    return p.parse_args()


def _rows_from_influencer_list(path: Path, run_id: str, now):
    handles = []
    for line in path.read_text(encoding="utf-8").splitlines():
        h = line.strip().lstrip("@").lower()
        if h and not h.startswith("#"):
            handles.append(h)
    seen = set()
    for h in handles:
        if h in seen:
            continue
        seen.add(h)
        yield {
            "account_id": h, "provider": PROVIDER_INSTAGRAM, "handle": h,
            "account_type": "influencer", "discovery_method": "influencer_list",
            "discovery_seed_place_id": None, "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }


def _latest_catalog_run_id(pipeline: BigQueryPipeline) -> str:
    sql = f"SELECT run_id FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY MAX(_PARTITIONTIME) DESC LIMIT 1"
    try:
        for row in pipeline.execute(sql):
            return row["run_id"]
    except Exception:  # _PARTITIONTIME が無い catalog もあるので run_id 単独で拾い直す
        for row in pipeline.execute(
            f"SELECT run_id, COUNT(*) c FROM `{pipeline.table('restaurant_catalog')}` GROUP BY run_id ORDER BY c DESC LIMIT 1"
        ):
            return row["run_id"]
    raise RuntimeError("restaurant_catalog に run_id が見つかりません。")


def _rows_from_open_data(pipeline: BigQueryPipeline, catalog_run_id: str, limit, run_id: str, now):
    from google.cloud import bigquery
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    sql = f"""
      SELECT google_place_id, social_urls
      FROM `{pipeline.table('restaurant_catalog')}`
      WHERE run_id = @crid
        AND EXISTS (SELECT 1 FROM UNNEST(social_urls) u WHERE LOWER(u) LIKE '%instagram.com/%')
      {limit_sql}
    """
    params = [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)]
    # #1273 チェーン除去: 同じ handle が複数 google_place_id に付いていたら «チェーン公式»で、
    # 特定の1店に紐付けると誤帰属になる（official_site_crawl の _store_branch_rows と同じ規律）。
    # 先に (handle → place_id 集合) を作り、**1店だけに付く handle** のみ store_branch にする。
    handle_to_pids: dict[str, set[str]] = {}
    for row in pipeline.execute(sql, params):
        for u in row["social_urls"] or []:
            handle = _extract_handle(u)
            if handle:
                handle_to_pids.setdefault(handle, set()).add(row["google_place_id"])
    dropped_chain = 0
    for handle, pids in handle_to_pids.items():
        if len(pids) >= 2:
            dropped_chain += 1
            continue
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "store_branch", "discovery_method": "open_data_socials",
            "discovery_seed_place_id": next(iter(pids)),
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("open_data_socials: 店固有 handle %d、チェーン除外 %d",
                sum(1 for h, p in handle_to_pids.items() if len(p) < 2), dropped_chain)


def _delete_source_rows(pipeline: BigQueryPipeline, run_id: str, source: str) -> int:
    """この run_id × discovery_method(=source) の行だけを消す（相乗り source を巻き込まない）。"""
    from google.cloud import bigquery
    sql = (
        f"DELETE FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` "
        f"WHERE run_id = @rid AND discovery_method = @dm"
    )
    job = pipeline.client.query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ScalarQueryParameter("dm", "STRING", source),
        ]),
        location=pipeline.config.region,
    )
    job.result()
    return int(job.num_dml_affected_rows or 0)


def store_branch_rows_from_crawl(pairs, run_id: str, now):
    """(google_place_id, handle) の集合 → store_branch 行群（グローバルチェーン除去つき）。

    純関数。柱1 の肝である «同じ handle が複数 google_place_id に付いたら、それはチェーン
    公式/集約アカウントであって店固有ではない» を、**全件を見て** 落とす（4_4 はバッチ分割で
    全件が見えないため、この判定はここでしか正しくできない）。

    - handle → distinct google_place_id 数を数える
    - 2 店以上に付く handle は除外（store_branch にしない）
    - 1 店だけに付く handle を store_branch として yield（discovery_method='official_site_crawl'）
    """
    handle_to_pids: dict[str, set[str]] = {}
    for pid, handle in pairs:
        if not pid or not handle:
            continue
        handle_to_pids.setdefault(handle, set()).add(pid)

    dropped_chain = 0
    for handle, pids in handle_to_pids.items():
        if len(pids) >= 2:
            dropped_chain += 1
            continue
        (pid,) = tuple(pids)
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "store_branch", "discovery_method": "official_site_crawl",
            "discovery_seed_place_id": pid,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("official_site_crawl: 店固有 handle %d、チェーン除外 handle %d",
                sum(1 for h, p in handle_to_pids.items() if len(p) < 2), dropped_chain)


def _rows_from_official_site_crawl(pipeline: BigQueryPipeline, crawl_run_id: str, run_id: str, now):
    from google.cloud import bigquery
    sql = f"""
      SELECT DISTINCT google_place_id, handle
      FROM `{pipeline.table(TABLE_STORE_SITE_IG)}`
      WHERE run_id = @crid AND handle IS NOT NULL
    """
    params = [bigquery.ScalarQueryParameter("crid", "STRING", crawl_run_id)]
    pairs = [(row["google_place_id"], row["handle"]) for row in pipeline.execute(sql, params)]
    yield from store_branch_rows_from_crawl(pairs, run_id, now)


# caption 内の @mention。IG の handle 規則（英数・_・. の 1〜30 文字）に合わせる。
_MENTION_RE = re.compile(r"@([A-Za-z0-9._]{2,30})")


def _rows_from_caption_mentions(pipeline: BigQueryPipeline, run_ids, min_posters: int,
                                run_id: str, now):
    """収集済み caption の @mention を新規アカウントとして採る（#1812 柱2 の自己増殖）。

    グルメアカウントは互いを、また店を @mention するので、収集 → mention 抽出 → 収集 と
    回すと handle が自己増殖する。**API を 1 回も使わない**（既に BQ にある caption を読むだけ）。
    実測（キャプション 1,800 件）: 新規 handle 636 件＝0.35 件/caption。

    account_type は «複数の投稿者から言及された» なら influencer、1 人だけなら unknown。
    店アカは 1 人の投稿者（その店自身）からしか出ないことが多く、この閾値で粗く分かれる。
    """
    from google.cloud import bigquery
    where = "caption IS NOT NULL AND caption != ''"
    params = []
    if run_ids:
        where += " AND run_id IN UNNEST(@rids)"
        params.append(bigquery.ArrayQueryParameter("rids", "STRING", run_ids))
    sql = f"""
      WITH src AS (SELECT account_id AS poster, caption FROM `{pipeline.table('sns_post_raw')}` WHERE {where}),
      m AS (
        SELECT LOWER(h) AS handle, poster
        FROM src, UNNEST(REGEXP_EXTRACT_ALL(caption, r'@([A-Za-z0-9._]{{2,30}})')) AS h
      ),
      agg AS (
        SELECT handle, COUNT(DISTINCT poster) posters, COUNT(*) mentions
        FROM m WHERE handle NOT IN UNNEST(@reserved) GROUP BY handle
      ),
      known AS (SELECT DISTINCT LOWER(handle) handle FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` WHERE handle IS NOT NULL)
      SELECT a.handle, a.posters, a.mentions
      FROM agg a LEFT JOIN known k USING (handle)
      WHERE k.handle IS NULL AND a.posters >= @minp
      ORDER BY a.posters DESC, a.mentions DESC
    """
    params += [bigquery.ArrayQueryParameter("reserved", "STRING", sorted(_NON_ACCOUNT)),
               bigquery.ScalarQueryParameter("minp", "INT64", int(min_posters))]
    n_infl = 0
    for row in pipeline.execute(sql, params):
        handle = row["handle"].strip(".")
        if not handle:
            continue
        is_infl = row["posters"] >= 2
        n_infl += is_infl
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "influencer" if is_infl else "unknown",
            "discovery_method": "caption_mentions", "discovery_seed_place_id": None,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("  うち複数投稿者から言及＝influencer 扱い: %d 件", n_infl)


def _rows_from_embedded_authors(pipeline: BigQueryPipeline, run_ids, min_posts: int,
                                run_id: str, now):
    """埋め込み経路（A/B/C）で採れた投稿の投稿者を、新しい収集元アカウントとして採る。

    #1815 【設計】柱2 の handle が 413 件しか無いのが business_discovery の枠を空ける原因だった。
    経路A/C で第三者ページから採った投稿には **投稿者 handle が必ず付いている**。
    しかもグルメ媒体が «埋め込むに値する» と判断したアカウントなので、飲食である確度が高い。
    caption_mentions（新規 80 件）と違い、こちらは投稿の実体を伴うので母数が桁で大きい。

    account_type は «複数のホストに埋め込まれている» なら influencer、1 ホストだけなら unknown。
    店アカは自分のサイト（経路B）や 1 つの記事にしか出ないことが多く、この閾値で粗く分かれる。
    """
    from google.cloud import bigquery
    where = "account_id IS NOT NULL AND account_id != ''"
    params = []
    if run_ids:
        where += " AND run_id IN UNNEST(@rids)"
        params.append(bigquery.ArrayQueryParameter("rids", "STRING", run_ids))
    sql = f"""
      WITH src AS (
        SELECT LOWER(account_id) AS handle, post_id,
               NET.HOST(discovery_query) AS host
        FROM `{pipeline.table('sns_post_raw')}` WHERE {where}
      ),
      agg AS (
        SELECT handle, COUNT(DISTINCT post_id) AS posts, COUNT(DISTINCT host) AS hosts
        FROM src WHERE handle NOT IN UNNEST(@reserved) GROUP BY handle
      ),
      known AS (SELECT DISTINCT LOWER(handle) handle FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` WHERE handle IS NOT NULL)
      SELECT a.handle, a.posts, a.hosts
      FROM agg a LEFT JOIN known k USING (handle)
      WHERE k.handle IS NULL AND a.posts >= @minp
      ORDER BY a.hosts DESC, a.posts DESC
    """
    params += [bigquery.ArrayQueryParameter("reserved", "STRING", sorted(_NON_ACCOUNT)),
               bigquery.ScalarQueryParameter("minp", "INT64", int(min_posts))]
    n_infl = 0
    for row in pipeline.execute(sql, params):
        handle = row["handle"].strip(".")
        if not handle:
            continue
        is_infl = row["hosts"] >= 2
        n_infl += is_infl
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "influencer" if is_infl else "unknown",
            "discovery_method": "embedded_authors", "discovery_seed_place_id": None,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("  うち複数ホストに埋め込まれ＝influencer 扱い: %d 件", n_infl)


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    with pipeline.step(run_id, f"4_1_discover_sns_accounts:{args.source}", repo_root=HERE.parents[1]) as result:
        # 同一 run の途中再開を冪等化。ただし run_id 単位 DELETE だと同じ run に相乗りする
        # 他 source（柱1+柱2 を同 run で流す等）を巻き込むため、この source の
        # discovery_method 行だけを消す。discovery_method は source と 1:1。
        _delete_source_rows(pipeline, run_id, args.source)
        if args.source == "influencer_list":
            rows = list(_rows_from_influencer_list(Path(args.handles_file), run_id, now))
        elif args.source == "caption_mentions":
            rids = [x.strip() for x in (args.caption_run_ids or "").split(",") if x.strip()]
            LOGGER.info("sns_post_raw の caption から @mention を抽出します（run_ids=%s）", rids or "全て")
            rows = list(_rows_from_caption_mentions(pipeline, rids, args.min_posters, run_id, now))
        elif args.source == "embedded_authors":
            rids = [x.strip() for x in (args.caption_run_ids or "").split(",") if x.strip()]
            LOGGER.info("sns_post_raw の投稿者 handle を採ります（run_ids=%s）", rids or "全て")
            rows = list(_rows_from_embedded_authors(pipeline, rids, args.min_posts, run_id, now))
        elif args.source == "official_site_crawl":
            crawl_rid = args.crawl_run_id or run_id
            LOGGER.info("sns_store_site_ig run_id=%s から店固有 IG を合流します", crawl_rid)
            rows = list(_rows_from_official_site_crawl(pipeline, crawl_rid, run_id, now))
        else:
            crid = args.catalog_run_id or _latest_catalog_run_id(pipeline)
            LOGGER.info("restaurant_catalog run_id=%s から店アカウントを抽出します", crid)
            rows = list(_rows_from_open_data(pipeline, crid, args.limit, run_id, now))
        count = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, rows)
        result["row_count"] = count
        LOGGER.info("sns_source_account に %d 件を投入しました（source=%s）", count, args.source)


if __name__ == "__main__":
    main()
