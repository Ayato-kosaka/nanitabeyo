#!/usr/bin/env python3
"""#1273 既にあるキャプションから «素のハンドル» で店を掘り起こす（外部 API を 1 回も使わない）。

## なぜ効くか（2026-09-05 実測）

`sns_post_raw` のキャプション 592,329 件のうち、`@` を含むのは 5.5% しか無い。埋め込み経路
（`/embed/captioned/` と第三者ページの blockquote）では **`@` がアンカータグごと剥がれ**、
`cafe_fune` のような素のトークンだけが本文に残るからである（`sns_html.strip_tags`）。
そのため `@` 前提の抽出（4_1 --source caption_mentions）は、この経路のハンドルを
**ほぼ全部取りこぼしていた**。

素のトークンとして抜いて、既にある **handle → google_place_id 辞書**
（`sns_store_site_ig` ＋ `sns_source_account.discovery_seed_place_id`。全部で 49,548 handle、
既定で使う «裏取り済み» に絞って 31,910 handle）に当てると、**API を 1 回も呼ばずに** «その投稿はどの店か» が確定する。確定した投稿へ
`discovery_seed_place_id` を後入れすれば、resolve の店照合（最大の漏れ）を通らずに
«店 × 料理カテゴリ» のペアになる（4_14 と同じ理屈）。

## この script がやること

1. キャプションから素のハンドル候補を抜く（規則は `common_sns.bare_handle_candidate_sql`。
   **一般語の誤爆を止める stoplist と «広がり» ガードもそこが正**）
2. handle → place_id 辞書に当てる
3. 当たった投稿へ `discovery_seed_place_id` を後入れする
   - **既に値がある行は上書きしない**（収集時に確定した店の方が確度が高い）
   - 1 投稿に **2 店以上**当たったら書かない（どちらの店の投稿か決められない）
4. 辞書に無い新規ハンドルを `sns_source_account` へ登録する（4_1 と同じ行の形。
   `discovery_method='caption_bare_handles'`）

## 実測（2026-09-05、キャプション 592,329 件 / 辞書 31,910 handle）

| 指標 | 値 |
| --- | --- |
| 辞書に当たった (投稿, handle) ペア（stoplist 前） | 69,498 |
| うち一般語として捨てた | 62,912（**誤爆率 90.5%**。`instagram` だけで 58,495） |
| 残った当たり | 6,586 ペア / 6,085 投稿 / 2,892 handle / 2,863 店 |
| 2 店以上当たって捨てた投稿 | 334 |
| 後入れできる（seed が空・店が 1 つ） | **4,319 投稿 / 2,403 店（うち新規 1,191 店）** |
| 新規候補ハンドル（未登録・2 投稿以上 × 2 投稿者以上） | 15,149（言及 166,763 件ぶん） |

精度サンプル 200 件（`1273_instagram_seed_poc/out/bare_handle_precision_sample.tsv`）を
目視した結果、**明らかな誤帰属は 8 件（4%）**。残る誤爆は 1 種類に集中している:

> **ブランド／チェーンのアカウントが «たまたま 1 店» の place_id に結びついている**
> （`haagendazs_jp` `chunshuitang.jp` `village_vanguard` `luckrack`、
> `wolfgangs_steakhouse_fukuoka` → 銀座の店 のような支店ずれ）。
> «同じ handle が複数店に付いたら捨てる» というチェーン除去は、**辞書側に 1 店ぶんしか
> 入っていないと効かない**。ここを潰すには辞書側（4_4 / 4_1）で «ブランド公式か支店か» を
> 分ける必要があり、この script の範囲では直せない。

辞書を裏取り無しまで広げる（`--include-uncorroborated`）と 6,056 投稿 / 1,721 新規店まで
増えるが、同じ 200 件サンプルで**誤帰属は 24 件（12%）**に増えた（観光協会・地域情報誌・
スタッフ個人・靴店を店として引き当てる）。既定は裏取り済みのみ。

## 使い方

    # 数えるだけ（書き込まない）＋ 精度サンプル 200 件
    python3 4_17_resolve_bare_handles.py --run-id sns-2026-09-05-bare --dry-run \
        --sample-out out/bare_handle_precision_sample.tsv

    # まず 1,000 件だけ後入れして精度を確かめる
    python3 4_17_resolve_bare_handles.py --run-id sns-2026-09-05-bare --limit 1000

    # 全量
    python3 4_17_resolve_bare_handles.py --run-id sns-2026-09-05-bare
"""

from __future__ import annotations

import argparse
import csv
import logging
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (
    BARE_HANDLE_MAX_POSTERS,
    GENERIC_HANDLE_STOPWORDS,
    PROVIDER_INSTAGRAM,
    STORE_ID_ANY_SQL,
    STORE_KNOWN_ANY_SQL,
    TABLE_POST_RAW,
    TABLE_POST_RESOLVED,
    TABLE_SOURCE_ACCOUNT,
    TABLE_STORE_SITE_IG,
    bare_handle_candidate_sql,
    store_handle_dict_sql,
)

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

# 4_1 の `--source` と 1:1 に対応する値（sns_source_account.discovery_method）。
# 新しい経路を作らず、4_1 が書くのと同じ形・同じテーブルへ入れる。
DISCOVERY_METHOD = "caption_bare_handles"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="キャプションの素のハンドルで店を確定し、seed を後入れする（API 不要）")
    p.add_argument("--run-id", default=None, help="この実行の run_id（sns_source_account へ入る）")
    p.add_argument("--dry-run", action="store_true",
                   help="数えるだけ。BigQuery へ 1 行も書かない")
    p.add_argument("--limit", type=int, default=None,
                   help="後入れする投稿数の上限（post_id 昇順）。精度確認は --limit 1000 から")
    p.add_argument("--sample-out", default=None,
                   help="精度サンプル（キャプション / 抜いたハンドル / 当てた店名）の出力先 TSV")
    p.add_argument("--sample-size", type=int, default=200, help="精度サンプルの件数")
    p.add_argument("--include-uncorroborated", action="store_true",
                   help="裏取りの無い店サイト crawl 由来の handle も引き当てに使う"
                        "（当たりは 1.4 倍になるが、精度サンプルで誤帰属も 4 倍になった）")
    p.add_argument("--skip-accounts", action="store_true",
                   help="新規候補ハンドルの sns_source_account 登録を行わない")
    p.add_argument("--min-posts", type=int, default=2,
                   help="新規候補として登録する最小の投稿数（誤字・一過性の語を落とす）")
    p.add_argument("--min-posters", type=int, default=2,
                   help="新規候補として登録する最小の異なり投稿者数")
    return p.parse_args()


# --- 共通 CTE ------------------------------------------------------------------
#
# 「抽出 → 辞書当て → 1 投稿 1 店」までを 1 か所で組み立て、統計・サンプル・書き込みの
# 3 つが**同じ集合**を見るようにする（数える側と書く側がずれると KPI が意味を失う）。


def _hits_with(pipeline: BigQueryPipeline, *, corroborated_only: bool = True) -> str:
    return (
        "WITH"
        + bare_handle_candidate_sql(pipeline.table(TABLE_POST_RAW))
        + ","
        + store_handle_dict_sql(pipeline.table(TABLE_STORE_SITE_IG),
                                pipeline.table(TABLE_SOURCE_ACCOUNT),
                                corroborated_only=corroborated_only)
        + """,
      hit AS (
        SELECT o.post_id, o.poster, o.seed, o.handle, d.place_id
        FROM ok o JOIN handle_dict d USING (handle)
      ),
      per_post AS (
        SELECT post_id, ANY_VALUE(seed) AS seed,
               COUNT(DISTINCT place_id) AS n_place,
               ANY_VALUE(place_id) AS place_id, ANY_VALUE(handle) AS handle
        FROM hit GROUP BY post_id
      ),
      writable AS (
        SELECT post_id, place_id, handle FROM per_post
        WHERE n_place = 1 AND (seed IS NULL OR seed = '')
      )"""
    )


def _params(pipeline_limit: int | None = None):
    from google.cloud import bigquery
    params = [
        bigquery.ArrayQueryParameter("stopwords", "STRING", list(GENERIC_HANDLE_STOPWORDS)),
        bigquery.ScalarQueryParameter("max_posters", "INT64", BARE_HANDLE_MAX_POSTERS),
    ]
    if pipeline_limit is not None:
        params.append(bigquery.ScalarQueryParameter("row_limit", "INT64", int(pipeline_limit)))
    return params


def stats_sql(pipeline: BigQueryPipeline, *, corroborated_only: bool = True) -> str:
    """誤爆率（stoplist 前後）と、確定する投稿数・店数・うち新規店を数える SQL。

    «既に知っている店» の判定は `STORE_ID_ANY_SQL` / `STORE_KNOWN_ANY_SQL`。ここは
    «その店の投稿をもう持っているか»（＝取りに行かなくてよいか）を見る広めの集合で、
    **配信・KPI 計上の «1 投稿 1 店» とは別物**（#1846: そちらは `post_store_cte_sql`）。
    広すぎても «取りに行かない店が少し増える» だけで、間違った店を見せることはない。

    ⚠️ SQL を組み立てる関数を実行から分けてあるのは、**BigQuery へ繋がない場所でも
    «実際に投げる SQL» をそのまま取り出して検証できる**ようにするため。
    検証用に SQL を書き写すと、写した側だけが古くなる。
    """
    return f"""
      {_hits_with(pipeline, corroborated_only=corroborated_only)},
      -- stoplist を当てる «前» の当たり（誤爆率の分母）
      raw_hit AS (
        SELECT c.post_id, c.handle FROM cand_all c JOIN handle_dict d USING (handle)
      ),
      known_store AS (
        SELECT DISTINCT {STORE_ID_ANY_SQL} AS place_id
        FROM `{pipeline.table(TABLE_POST_RAW)}` r
        LEFT JOIN `{pipeline.table(TABLE_POST_RESOLVED)}` v USING (post_id)
        WHERE {STORE_KNOWN_ANY_SQL}
      )
      SELECT
        (SELECT COUNT(*) FROM raw_hit) AS raw_pairs,
        (SELECT COUNT(*) FROM hit) AS kept_pairs,
        (SELECT COUNT(*) FROM per_post) AS hit_posts,
        (SELECT COUNTIF(n_place >= 2) FROM per_post) AS ambiguous_posts,
        (SELECT COUNT(DISTINCT handle) FROM hit) AS kept_handles,
        (SELECT COUNT(DISTINCT place_id) FROM hit) AS kept_stores,
        (SELECT COUNT(*) FROM writable) AS writable_posts,
        (SELECT COUNT(DISTINCT place_id) FROM writable) AS writable_stores,
        (SELECT COUNT(DISTINCT w.place_id) FROM writable w
          WHERE w.place_id NOT IN (SELECT place_id FROM known_store WHERE place_id IS NOT NULL)
        ) AS new_stores
    """


def report_stats(pipeline: BigQueryPipeline, *, corroborated_only: bool = True) -> dict:
    """`stats_sql` を投げてログへ出し、数字を返す。"""
    sql = stats_sql(pipeline, corroborated_only=corroborated_only)
    row = dict(next(iter(pipeline.execute(sql, _params()))))
    stop_pairs = row["raw_pairs"] - row["kept_pairs"]
    ratio = stop_pairs / row["raw_pairs"] if row["raw_pairs"] else 0.0
    LOGGER.info("辞書ヒット（stoplist 前）: %d ペア", row["raw_pairs"])
    LOGGER.info("  うち一般語として捨てた: %d ペア（誤爆率 %.1f%%）", stop_pairs, ratio * 100)
    LOGGER.info("残った当たり: %d ペア / %d 投稿 / %d handle / %d 店",
                row["kept_pairs"], row["hit_posts"], row["kept_handles"], row["kept_stores"])
    LOGGER.info("  2 店以上当たって捨てた投稿: %d 件", row["ambiguous_posts"])
    LOGGER.info("後入れできる（seed が空・店が 1 つ）: %d 投稿 / %d 店（うち新規 %d 店）",
                row["writable_posts"], row["writable_stores"], row["new_stores"])
    row["stop_pairs"] = stop_pairs
    row["stop_ratio"] = ratio
    return row


def sample_sql(pipeline: BigQueryPipeline, *, corroborated_only: bool = True) -> str:
    """精度サンプル（キャプション / 抜いたハンドル / 当てた店名）を引く SQL。

    キャプション全文は長いので、**当たったハンドルの前後 120 文字**を切って出す
    （どの文脈で出てきたハンドルなのかが分かれば、人が誤帰属を判定できる）。
    """
    return f"""
      {_hits_with(pipeline, corroborated_only=corroborated_only)},
      cat AS (
        SELECT google_place_id, name, address FROM `{pipeline.table('restaurant_catalog')}`
        WHERE run_id = (SELECT run_id FROM `{pipeline.table('restaurant_catalog')}`
                        GROUP BY run_id ORDER BY COUNT(*) DESC LIMIT 1)
      ),
      picked AS (
        SELECT * FROM writable ORDER BY FARM_FINGERPRINT(post_id) LIMIT @row_limit
      )
      SELECT p.post_id, p.handle, p.place_id,
             c.name AS store_name, c.address AS store_address,
             r.discovery_method, r.account_id AS poster, r.canonical_url,
             SUBSTR(REGEXP_REPLACE(LOWER(NORMALIZE(r.caption, NFKC)), r'\\s+', ' '),
                    GREATEST(1, STRPOS(REGEXP_REPLACE(LOWER(NORMALIZE(r.caption, NFKC)), r'\\s+', ' '),
                                       p.handle) - 120),
                    260) AS caption_window
      FROM picked p
      JOIN `{pipeline.table(TABLE_POST_RAW)}` r ON r.post_id = p.post_id
      LEFT JOIN cat c ON c.google_place_id = p.place_id
      QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY r.fetched_at DESC) = 1
      ORDER BY p.post_id
    """


def write_sample(pipeline: BigQueryPipeline, path: Path, size: int,
                 *, corroborated_only: bool = True) -> int:
    """`sample_sql` の結果を TSV へ書く。"""
    sql = sample_sql(pipeline, corroborated_only=corroborated_only)
    rows = [dict(r) for r in pipeline.execute(sql, _params(size))]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(["post_id", "handle", "place_id", "store_name", "store_address",
                         "discovery_method", "poster", "canonical_url", "caption_window"])
        for r in rows:
            writer.writerow([r["post_id"], r["handle"], r["place_id"], r["store_name"] or "",
                             r["store_address"] or "", r["discovery_method"] or "",
                             r["poster"] or "", r["canonical_url"] or "",
                             (r["caption_window"] or "").replace("\t", " ")])
    LOGGER.info("精度サンプルを %d 件書き出しました: %s", len(rows), path)
    return len(rows)


def backfill_sql(pipeline: BigQueryPipeline, limit: int | None,
                 *, corroborated_only: bool = True) -> str:
    """当たった投稿へ discovery_seed_place_id を後入れする UPDATE。

    - **既に値がある行は触らない**（収集時に確定した店の方が確度が高い）
    - 同じ post_id の行が複数 run にまたがって入っていることがあるので、
      «まだ空の行» は全部埋める（1 投稿 1 店の判定は `writable` が済ませている）
    - **`seed_source` に印を付ける。** ここで入れた seed は目視 200 件で誤帰属 4% あり、
      収集時に確定した seed（そのアカウント＝その店）とは確度が違う。印が無いと両者が混ざって
      **監査も巻き戻しもできない**（経路で偶然区別できるのは今だけで、設計された区別ではない）。

      ⚠️ **`discovery_method` を上書きしない。** あれは «どうやってこの投稿を見つけたか»
      （ig_business_discovery / tavily / media_embed …）であって «店をどう決めたか» ではない。
      上書きすると収集経路の情報が消える。専用の列を使う。
    """
    limit_sql = "ORDER BY post_id LIMIT @row_limit" if limit else ""
    return f"""
      UPDATE `{pipeline.table(TABLE_POST_RAW)}` r
      SET discovery_seed_place_id = m.place_id,
          seed_source = '{DISCOVERY_METHOD}'
      FROM ({_hits_with(pipeline, corroborated_only=corroborated_only)}
            SELECT post_id, place_id FROM writable {limit_sql}) m
      WHERE r.post_id = m.post_id
        AND (r.discovery_seed_place_id IS NULL OR r.discovery_seed_place_id = '')
    """


def backfill_seed(pipeline: BigQueryPipeline, limit: int | None,
                  *, corroborated_only: bool = True) -> int:
    """`backfill_sql` を実行し、埋めた行数を返す。"""
    from google.cloud import bigquery
    job = pipeline.client.query(
        backfill_sql(pipeline, limit, corroborated_only=corroborated_only),
        job_config=bigquery.QueryJobConfig(query_parameters=_params(limit)),
        location=pipeline.config.region,
    )
    job.result()
    n = int(job.num_dml_affected_rows or 0)
    LOGGER.info("discovery_seed_place_id を後入れした行: %d", n)
    return n


def new_accounts_sql(pipeline: BigQueryPipeline) -> str:
    """辞書にも `sns_source_account` にも無い «新規候補ハンドル» を引く SQL。

    ここの `handle_dict` だけは **裏取りの有無にかかわらず全部**を使う
    （`corroborated_only=False`）。«引き当ててよいか» ではなく «もう知っているか» の
    判定なので、裏取りが無くても既知なら新規ではない。
    """
    return f"""
      WITH{bare_handle_candidate_sql(pipeline.table(TABLE_POST_RAW))},
      {store_handle_dict_sql(pipeline.table(TABLE_STORE_SITE_IG), pipeline.table(TABLE_SOURCE_ACCOUNT), corroborated_only=False)},
      known AS (
        SELECT DISTINCT LOWER(handle) AS handle
        FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` WHERE handle IS NOT NULL
      ),
      agg AS (
        SELECT handle, COUNT(DISTINCT post_id) AS posts,
               COUNT(DISTINCT NULLIF(poster, '')) AS posters
        FROM ok GROUP BY handle
      )
      SELECT a.handle, a.posts, a.posters
      FROM agg a
      LEFT JOIN known k USING (handle)
      LEFT JOIN handle_dict d USING (handle)
      WHERE k.handle IS NULL AND d.handle IS NULL
        AND a.posts >= @min_posts AND a.posters >= @min_posters
      ORDER BY a.posts DESC, a.posters DESC
    """


def new_account_rows(pipeline: BigQueryPipeline, min_posts: int, min_posters: int,
                     run_id: str, now):
    """新規候補ハンドルを、**4_1 と同じ行の形**で返す（新しい経路を作らない）。

    account_type は 4_1 --source caption_mentions と同じ規律（複数の投稿者から言及されたら
    influencer、1 人だけなら unknown）。**店かどうかはここでは決めない**（決めるのは
    4_2 で投稿を採ってから resolve）。
    """
    from google.cloud import bigquery
    params = _params() + [
        bigquery.ScalarQueryParameter("min_posts", "INT64", int(min_posts)),
        bigquery.ScalarQueryParameter("min_posters", "INT64", int(min_posters)),
    ]
    n_infl = 0
    for row in pipeline.execute(new_accounts_sql(pipeline), params):
        handle = row["handle"].strip(".")
        if not handle:
            continue
        is_infl = row["posters"] >= 2
        n_infl += is_infl
        yield {
            "account_id": handle, "provider": PROVIDER_INSTAGRAM, "handle": handle,
            "account_type": "influencer" if is_infl else "unknown",
            "discovery_method": DISCOVERY_METHOD, "discovery_seed_place_id": None,
            "followers": None, "media_count": None,
            "discovered_at": now.isoformat(), "run_id": run_id,
        }
    LOGGER.info("  うち複数投稿者から言及＝influencer 扱い: %d 件", n_infl)


def delete_own_account_rows(pipeline: BigQueryPipeline, run_id: str) -> int:
    """この run × この discovery_method の行だけ消して、途中再開を冪等にする。

    run_id 単位の DELETE だと、同じ run に相乗りする他 source を巻き込む（4_1 と同じ理由）。
    """
    from google.cloud import bigquery
    job = pipeline.client.query(
        f"DELETE FROM `{pipeline.table(TABLE_SOURCE_ACCOUNT)}` "
        f"WHERE run_id = @rid AND discovery_method = @dm",
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("rid", "STRING", run_id),
            bigquery.ScalarQueryParameter("dm", "STRING", DISCOVERY_METHOD),
        ]),
        location=pipeline.config.region,
    )
    job.result()
    return int(job.num_dml_affected_rows or 0)


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    now = utc_now()

    corr = not args.include_uncorroborated
    LOGGER.info("引き当てに使う辞書: %s",
                "裏取り済みのみ（既定）" if corr else "裏取り無しも含める")

    with pipeline.step(run_id, "4_17_resolve_bare_handles", repo_root=HERE.parents[1]) as result:
        stats = report_stats(pipeline, corroborated_only=corr)

        if args.sample_out:
            write_sample(pipeline, Path(args.sample_out), args.sample_size,
                         corroborated_only=corr)

        if args.dry_run:
            LOGGER.info("--dry-run のため BigQuery へは 1 行も書きません。")
            result["row_count"] = 0
            return

        updated = backfill_seed(pipeline, args.limit, corroborated_only=corr)
        result["row_count"] = updated

        if args.skip_accounts:
            LOGGER.info("--skip-accounts のため新規候補ハンドルの登録は行いません。")
            return
        delete_own_account_rows(pipeline, run_id)
        rows = list(new_account_rows(pipeline, args.min_posts, args.min_posters, run_id, now))
        if rows:
            n = pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, rows)
            LOGGER.info("sns_source_account に %d 件を投入しました（source=%s）", n, DISCOVERY_METHOD)
        else:
            LOGGER.info("登録する新規候補ハンドルはありませんでした。")
        LOGGER.info("（参考）確定した店 %d 店・うち新規 %d 店",
                    stats["writable_stores"], stats["new_stores"])


if __name__ == "__main__":
    main()
