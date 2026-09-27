#!/usr/bin/env python3
"""#1947 収集ルート: Instagram Graph API の **ハッシュタグ検索**で、合格線の未達地点に
投稿を撃ち込む。

## なぜこれを今やるか

合格線（上位 70% 地点の 70%）は **18 カタログ連続で 132/219（60.3%）**。足りないのは
**21 地点・29 店**で、そこには «呼べるハンドル» が 1 本も無い（`7_5` の «撃てる弾 0 / 21»）。
21 地点の 500m 圏には台帳の店が中央値 63 軒あるのに、**1,477 軒はハンドルすら無く、
そのうち 1,030 軒はサイトも無い**。サイト crawl（`4_23`）は残り 0。
つまり «店 → ハンドル» の向きの経路は全部閉じている。

残っていたのは **«地点 → 投稿» の向き**である。#1273 の PoC の一覧（`1273_instagram_seed_poc/
FINDINGS.md` 行 6）は「IG プロフィール/ハッシュタグ HTML」を `robots.txt` の
`Disallow: /` で却下していたが、**同じ行の但し書きに «ハッシュタグは Graph API の
`ig_hashtag_search` なら可» と書いてある**。HTML の scrape と API を 1 行に混ぜたため、
API の側が一度も試されないまま «却下» の見た目になっていた。

⚠️ **これは規約の迂回ではない。** 公式に文書化された endpoint を、文書化された
クォータの内側で呼ぶ。scrape もしないし、IP も分散しない。

## 唯一の希少資源＝«7 日で 30 タグ»

`ig_hashtag_search` は **1 IG ユーザにつき 7 日で 30 個の異なるタグ**しか引けない。
使い切ると 1 週間戻らないので、この script は台帳（`sns_hashtag_search_attempt`）に
引いたタグを残し、**7 日の窓で 30 個を越えそうなら自分から引かない**。
一度引いた tag の hashtag_id は台帳から再利用するので、同じタグの追撃は窓を消費しない。

## 使い方

    # 1) 1 タグだけで «そもそも返るのか / 何件返るのか» を測る（BQ へは書かない）
    python3 4_25_collect_hashtag_posts.py --run-id hashtag-probe --probe 所沢グルメ

    # 2) 地点ごとのタグを流す（TSV: tag<TAB>lat<TAB>lng<TAB>category_id?）
    python3 4_25_collect_hashtag_posts.py --run-id sns-... --tags-file gap_tags.tsv

`lat/lng` は **その未達地点の座標**を入れる。ハッシュタグの投稿には位置情報が無いので、
これが resolve にとっての «どこの店を探すか» になる（`discovery_area_lat/lng`）。
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import sys
import time
import urllib.parse
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW

LOGGER = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent

# 引いたタグの台帳。«7 日で 30 タグ» を守るための唯一の正。
TABLE_HASHTAG_ATTEMPT = "sns_hashtag_search_attempt"
CREATE_HASHTAG_ATTEMPT_SQL = """
CREATE TABLE IF NOT EXISTS `__TABLE__` (
  tag STRING NOT NULL,
  hashtag_id STRING,
  run_id STRING NOT NULL,
  searched_at TIMESTAMP NOT NULL,
  outcome STRING NOT NULL  -- 'ok' / 'not_found' / 'error'
) PARTITION BY DATE(searched_at) CLUSTER BY tag
OPTIONS (description = 'ig_hashtag_search で引いたタグの台帳。7 日で 30 タグの窓を守るために使う。append-only。#1947')
"""

# IG の窓（公式ドキュメントの値）。**緩めない。**
TAG_WINDOW_DAYS = 7
TAG_WINDOW_LIMIT = 30


def _ig_module():
    """`4_2` の Graph API ヘルパ（_get / resolve_ig_user_id / GRAPH）を借りる。

    ⚠️ 写経しない。一時エラーの再送・レート制限の判定・x-app-usage の記録は
    `4_2` が唯一の正で、複製すると片方だけ直った状態が残る（CLAUDE.md の規則）。
    """
    spec = importlib.util.spec_from_file_location(
        "m42_ig", HERE / "4_2_collect_account_posts.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["m42_ig"] = m
    spec.loader.exec_module(m)
    return m


def window_sql(attempt_table: str) -> str:
    """7 日の窓のなかで «引いた異なるタグ» と、その hashtag_id を返す SQL。"""
    return f"""
      SELECT tag, ANY_VALUE(hashtag_id) AS hashtag_id, MAX(searched_at) AS last_at
      FROM `{attempt_table}`
      WHERE searched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {TAG_WINDOW_DAYS} DAY)
        AND outcome = 'ok'
      GROUP BY tag"""


def is_comment(line: str) -> bool:
    """コメント行か。

    ⚠️ **`#` 始まりを一律コメントにしてはいけない。** ハッシュタグは `#所沢グルメ` と
    書くのが自然なので、それを飲み込むと **タグが 1 つも無いまま «完了» するラウンド**が
    できる（テストで実際に捕まえた）。`#` のあとが空白か `#` のときだけコメントとする。
    """
    t = line.strip()
    if not t:
        return True
    if not t.startswith("#"):
        return False
    rest = t[1:]
    return rest == "" or rest[0].isspace() or rest[0] == "#"


def read_tags(path: Path, limit: int | None):
    """TSV: tag<TAB>lat<TAB>lng<TAB>category_id? を読む。"""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.rstrip("\n")
        if is_comment(line):
            continue
        parts = line.split("\t")
        tag = parts[0].strip().lstrip("#")
        lat = float(parts[1]) if len(parts) > 1 and parts[1].strip() else None
        lng = float(parts[2]) if len(parts) > 2 and parts[2].strip() else None
        cat = parts[3].strip() if len(parts) > 3 and parts[3].strip() else None
        if tag:
            out.append((tag, lat, lng, cat))
    return out[:limit] if limit else out


def search_hashtag_id(ig_mod, ig_user: str, token: str, tag: str) -> str | None:
    """タグ名 → hashtag_id。**この呼び出しが «30 / 7 日» を消費する。**"""
    q = urllib.parse.urlencode({"user_id": ig_user, "q": tag, "access_token": token})
    d = ig_mod._get(f"{ig_mod.GRAPH}/ig_hashtag_search?{q}")
    data = d.get("data") or []
    return data[0].get("id") if data and data[0].get("id") else None


MEDIA_FIELDS = "id,caption,permalink,media_type,timestamp,like_count,comments_count"


def media_pages(ig_mod, hashtag_id: str, ig_user: str, token: str, edge: str,
                per_page: int, max_posts: int, sleep_s: float):
    """`top_media` / `recent_media` をページングして media dict を yield する。

    ⚠️ hashtag_id を持っている限り、この呼び出しは «30 / 7 日» を消費しない
    （消費するのは `ig_hashtag_search` の方だけ）。
    """
    after = None
    got = 0
    while got < max_posts:
        params = {"user_id": ig_user, "fields": MEDIA_FIELDS,
                  "limit": min(per_page, max_posts - got), "access_token": token}
        if after:
            params["after"] = after
        d = ig_mod._get(f"{ig_mod.GRAPH}/{hashtag_id}/{edge}?{urllib.parse.urlencode(params)}")
        items = d.get("data") or []
        if not items:
            return
        for it in items:
            yield it
            got += 1
            if got >= max_posts:
                return
        after = ((d.get("paging") or {}).get("cursors") or {}).get("after")
        if not after:
            return
        if sleep_s:
            time.sleep(sleep_s)


def row_from_media(media: dict, *, tag: str, lat, lng, cat, run_id: str,
                   ig_shortcode_from_url) -> dict | None:
    """media dict → sns_post_raw の 1 行。shortcode が取れないものは捨てる。

    ⚠️ post_id は **shortcode**（他ルートと同じ自然キー）。IG の media id を使うと
    business_discovery / CC WAT と重複解決できない。
    """
    url = media.get("permalink") or ""
    code = ig_shortcode_from_url(url)
    if not code:
        return None
    return {
        "post_id": code, "provider": PROVIDER_INSTAGRAM, "canonical_url": url,
        "account_id": None,
        # 既存の 'hashtag_search'（SERPER 経由）とは別ルートとして数えたいので分ける。
        "discovery_route": "hashtag_api",
        "discovery_method": "ig_hashtag_top_media",
        "discovery_query": f"#{tag}",
        "discovery_seed_place_id": None,
        # ハッシュタグの投稿に位置情報は無い。**地点の座標を渡すのがこのルートの要**。
        "discovery_area_lat": lat, "discovery_area_lng": lng,
        "discovery_category_id": cat,
        # ⚠️ #1947 run 開始時刻を焼き付けない（行が起きた瞬間を使う）
        "fetched_at": utc_now().isoformat(), "run_id": run_id,
        "caption": media.get("caption") or None,
        "author_name": None,
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="IG Graph API のハッシュタグ検索で投稿を集める")
    p.add_argument("--run-id", default=None)
    p.add_argument("--probe", default=None,
                   help="このタグ 1 個だけを引いて «何が返るか» を測る（BQ へは書かない）")
    p.add_argument("--tags-file", default=None,
                   help="TSV: tag<TAB>lat<TAB>lng<TAB>category_id?")
    p.add_argument("--max-tags", type=int, default=None, help="このラウンドで引くタグ数の上限")
    p.add_argument("--edge", default="top_media", choices=("top_media", "recent_media"),
                   help="top_media は人気順（期間の制限なし）/ recent_media は直近 24 時間だけ")
    p.add_argument("--max-posts-per-tag", type=int, default=200)
    p.add_argument("--per-page", type=int, default=50)
    p.add_argument("--sleep-ms", type=int, default=300)
    p.add_argument("--token-env", default="IG_TOKEN")
    p.add_argument("--user-env", default="IG_USER_ID")
    p.add_argument("--dry-run", action="store_true", help="BQ へ書かない")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    if not args.probe and not args.tags_file:
        raise SystemExit("--probe か --tags-file のどちらかが必要です")
    run_id = require_run_id(args.run_id)

    token = os.getenv(args.token_env)
    if not token:
        raise RuntimeError(f"{args.token_env} 未設定（db-script-run.yml の secret）。")

    ig_mod = _ig_module()
    ig_user = ig_mod.resolve_ig_user_id(token, args.user_env)
    from common_sns import ig_shortcode_from_url

    pipeline = BigQueryPipeline()
    attempt_table = pipeline.table(TABLE_HASHTAG_ATTEMPT)
    if not args.dry_run:
        pipeline.execute(CREATE_HASHTAG_ATTEMPT_SQL.replace("__TABLE__", attempt_table))

    # 7 日の窓で «もう引いたタグ» を読む。引いてあるタグは窓を消費せずに追撃できる。
    known = {}
    try:
        for r in pipeline.execute(window_sql(attempt_table)):
            known[r["tag"]] = r["hashtag_id"]
    except Exception as e:  # noqa: BLE001 - 台帳が無い初回は空で進む
        LOGGER.info("台帳をまだ読めません（初回なら正常）: %s", e)
    LOGGER.info("直近 %d 日で引いたタグ %d / %d（残り %d タグ）",
                TAG_WINDOW_DAYS, len(known), TAG_WINDOW_LIMIT,
                max(0, TAG_WINDOW_LIMIT - len(known)))

    targets = ([(args.probe.lstrip("#"), None, None, None)] if args.probe
               else read_tags(Path(args.tags_file), args.max_tags))
    # ⚠️ «仕事が無いのに黙って完了する» を作らない（CLAUDE.md の禁止事項）。
    if not targets:
        raise SystemExit(f"タグが 1 つも読めませんでした: {args.tags_file}"
                         "（コメントは «# » か «##» で始める。«#タグ名» はタグとして読みます）")
    LOGGER.info("対象タグ %d 件", len(targets))

    sleep_s = max(args.sleep_ms, 0) / 1000.0
    rows: list[dict] = []
    attempts: list[dict] = []
    seen: set[str] = set()
    spent = 0
    skipped_budget: list[str] = []

    for tag, lat, lng, cat in targets:
        hid = known.get(tag)
        if not hid:
            # ⚠️ **ここだけが希少資源を消費する。** 窓を越えるなら引かずに残す。
            if len(known) + spent >= TAG_WINDOW_LIMIT:
                skipped_budget.append(tag)
                continue
            try:
                hid = search_hashtag_id(ig_mod, ig_user, token, tag)
            except Exception as e:  # noqa: BLE001
                LOGGER.warning("タグ «%s» を引けませんでした: %s", tag, e)
                attempts.append({"tag": tag, "hashtag_id": None, "run_id": run_id,
                                 "searched_at": utc_now().isoformat(), "outcome": "error"})
                continue
            spent += 1
            attempts.append({"tag": tag, "hashtag_id": hid, "run_id": run_id,
                             "searched_at": utc_now().isoformat(),
                             "outcome": "ok" if hid else "not_found"})
            if not hid:
                LOGGER.warning("タグ «%s» は IG 側に存在しません（窓は 1 個消費した）", tag)
                continue

        n_tag = 0
        with_caption = 0
        for media in media_pages(ig_mod, hid, ig_user, token, args.edge,
                                 args.per_page, args.max_posts_per_tag, sleep_s):
            n_tag += 1
            if media.get("caption"):
                with_caption += 1
            if args.probe:
                if n_tag <= 3:
                    LOGGER.info("  例 %d: %s / caption %d 文字 / %s", n_tag,
                                media.get("permalink"), len(media.get("caption") or ""),
                                media.get("timestamp"))
                continue
            row = row_from_media(media, tag=tag, lat=lat, lng=lng, cat=cat, run_id=run_id,
                                 ig_shortcode_from_url=ig_shortcode_from_url)
            if row and row["post_id"] not in seen:
                seen.add(row["post_id"])
                rows.append(row)
        LOGGER.info("#%s（%s）: %d 投稿・本文あり %d（%.0f%%）", tag, args.edge, n_tag,
                    with_caption, 100.0 * with_caption / n_tag if n_tag else 0.0)

    if skipped_budget:
        LOGGER.warning("⚠️ **7 日で 30 タグの窓に当たったので %d タグは引きませんでした**: %s。"
                       "窓が開くのを待つこと（回避策は実装しない）",
                       len(skipped_budget), ",".join(skipped_budget))

    if args.dry_run or args.probe:
        LOGGER.info("probe/dry-run: BQ へは書きません（消費したタグ %d 個は台帳へ入れます）", spent)
        if attempts and not args.dry_run:
            pipeline.load_json_rows(TABLE_HASHTAG_ATTEMPT, attempts)
        return

    with pipeline.step(run_id, "4_25_collect_hashtag_posts", parameters={
        "tags": len(targets), "edge": args.edge, "tags_spent": spent,
    }, repo_root=Path(__file__).resolve().parents[1]) as result:
        if attempts:
            pipeline.load_json_rows(TABLE_HASHTAG_ATTEMPT, attempts)
        if rows:
            from google.cloud import bigquery
            ids = sorted({r["post_id"] for r in rows})
            for i in range(0, len(ids), 5000):
                chunk = ids[i:i + 5000]
                pipeline.execute(
                    f"DELETE FROM `{pipeline.table(TABLE_POST_RAW)}` "
                    f"WHERE run_id=@rid AND post_id IN UNNEST(@ids)",
                    [bigquery.ScalarQueryParameter("rid", "STRING", run_id),
                     bigquery.ArrayQueryParameter("ids", "STRING", chunk)])
        count = pipeline.load_json_rows(TABLE_POST_RAW, rows) if rows else 0
        result["row_count"] = count
        result["tags_spent"] = spent
        result["tags_skipped_by_budget"] = len(skipped_budget)
        LOGGER.info("sns_post_raw に %d 投稿を投入しました（タグ %d 個を消費・%d 個は窓で見送り）",
                    count, spent, len(skipped_budget))


if __name__ == "__main__":
    main()
