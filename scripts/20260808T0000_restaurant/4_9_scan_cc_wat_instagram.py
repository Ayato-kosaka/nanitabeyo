#!/usr/bin/env python3
"""#1273 柱4 改: Common Crawl WAT から Instagram 投稿URL＋キャプション＋handle を採る。

## なぜこれが要るか（#1812）
「投稿URL＋キャプション」の取得が全体の律速で、手段は business_discovery（200コール/時）と
検索インデックス（無料枠 合計 26,000 クエリ）しか無く、どちらも上限がある。
CC は無料・総量無制限で、上限が無い唯一の経路である。

## なぜ «キャプションまで» 採れるのか（ここが要点）
Instagram 公式の埋め込み（blockquote）は、**投稿本文をそのままアンカーテキストとして
HTML に持つ**。WAT はページの `Links[].text` を保存しているので、
`(投稿URL, キャプション, handle)` の 3 点が **Instagram を一度も叩かずに** 揃う。
handle は同じ埋め込みの «(@handle)がシェアした投稿» から採れるので、
business_discovery を使わずに «アカウント → 投稿» を得る経路にもなる。

キャプションが取れることが決定的なのは、resolve が caption を渡されると Instagram を
取りに行かず純テキスト処理になる（=並列無制限・レート制限なし）ためである。
キャプションの無い投稿URLは resolve が IG 取得に回るので、実質使えない。

## 店の紐づけ
1. ソースページのホストがカタログ店の website と一致 → その店の投稿（seed-trust）
2. それ以外は «日本語のキャプション/タイトルを持つもの» だけ残し、店は resolve に任せる
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import re
import urllib.request
import time
from datetime import timezone

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import (PROVIDER_INSTAGRAM, TABLE_POST_RAW, TABLE_SOURCE_ACCOUNT,
                        area_from_text, build_city_index, city_index_sql,
                        store_site_host_sql)

LOGGER = logging.getLogger(__name__)


def _index_range(shards: int, shard: int, skip_files: int, n: int) -> str:
    """このジョブが読む WAT の «crawl 全体での» ファイル番号の範囲を `"16000-31992"` の形で返す。

    #1947 `shards`/`shard`/`skip_files` の 3 つを人が暗算しないと «どこを読んだか» が
    分からないのを、記録の側で解いておく。`n == 0` のときは `"-"`。
    """
    if n <= 0:
        return "-"
    s = max(shards, 1)
    return f"{skip_files * s + shard}-{(skip_files + n - 1) * s + shard}"


def stripe_indices(shards: int, shard: int, skip_files: int, n: int) -> set[int]:
    """このジョブが読む WAT の «crawl 全体でのファイル番号» の集合（純関数）。

    `_index_range` が人向けに畳んでいるものを、集合として返すだけ。
    `shards` が違うラウンド同士を比べられるのは、この «絶対番号» の上でだけである
    （ストライプ上の `skip_files` は `shards` が違うと別の場所を指す）。
    """
    s = max(shards, 1)
    return {(skip_files + j) * s + shard for j in range(max(n, 0))}


def already_read_indices(records) -> set[int]:
    """すでに読んだ «crawl 全体でのファイル番号» の集合。

    #1947 ⚠️ **この判定を人の暗算に任せた結果、2026-10-01 に 5 ラウンド（約 25 レーン時間）が
    «もう読んだファイル» を読み直した。** CC-MAIN-2026-34 は 9 月に 100,000 本すべて
    読み終わっていたのに、`--skip-files 0 / 500 / 1000` を投げ直していた。新規投稿は
    82,938 件中 **2,440 件（2.9%）**で、しかも run は緑で «成功» と出た。
    唯一の durable な記録は `restaurant_pipeline_runs.parameters_json` なので、
    **投げる前にそこを読む**。

    `records` は `shards` / `shard` / `skip_files` / `files`（＋あれば実際に読んだ
    `files_read`）を持つ dict の列。**`files_read` がある行はそちらを使う**
    （`--max-minutes` で途中で降りた run は `files` 本を読んでいない）。
    """
    read: set[int] = set()
    for r in records:
        n = r.get("files_read")
        if n is None:
            n = r.get("files") or 0
        read |= stripe_indices(int(r.get("shards") or 1), int(r.get("shard") or 0),
                               int(r.get("skip_files") or 0), int(n))
    return read


def unread_skip(shards: int, shard: int, max_files: int, already: set[int],
                stripe_len: int) -> int | None:
    """まだ 1 本も読んでいない窓の先頭（`--skip-files` に渡す値）。無ければ None。

    «重なりゼロの窓» を先頭から探す。半端に重なる窓を返さないのは、
    «どこまで読んだか» が次のラウンドでまた曖昧になるからである。
    """
    step = max(max_files, 1)
    for skip in range(0, max(stripe_len, 0), step):
        n = min(step, stripe_len - skip)
        if n <= 0:
            return None
        if not (stripe_indices(shards, shard, skip, n) & already):
            return skip
    return None


def select_files(paths: list[str], *, shards: int, shard: int,
                 max_files: int, skip_files: int = 0) -> list[str]:
    """このジョブが読む WAT ファイルを選ぶ（純関数）。

    ⚠️ **`--skip-files` が «続きから» の唯一の手段である。** ストライプは必ず先頭から
    始まるので、`--shards` / `--shard` をどう変えても 0 番付近から取り直すことになる。
    2026-09-04 の 5 ラウンドはすべてファイル 0〜15,999 番に当たっており、
    crawl 10 万本のうち **16.0% しか読めていなかった**（`restaurant_pipeline_runs` の
    `parameters_json` で実測: shards=8 × files=2000 と shards=6 × files=1600）。

    次のラウンドは `--skip-files` に «そのシャードで既に読んだ本数» を渡すこと。
    """
    stripe = [p for i, p in enumerate(paths) if i % max(shards, 1) == shard]
    return stripe[skip_files: skip_files + max_files]
BASE = "https://data.commoncrawl.org/"
UA = {"User-Agent": "nanitabeyo-research/1.0 (+dish_media seed; contact via github.com/Ayato-kosaka/nanitabeyo)"}

RESERVED = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about",
            "developer", "legal", "privacy", "terms", "help", "api", "graphql", "web", "static"}
RE_IG_POST = re.compile(r"instagram\.com/(?:([A-Za-z0-9._]{2,30})/)?(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})")
# 中国語（繁体字ブログ）が大量に混ざるので、漢字だけでは日本語と判定できない。
# かな（ひらがな/カタカナ）は日本語にしか無いので、これを日本語の判定に使う。
RE_KANA = re.compile(r"[ぁ-んァ-ヴー]")
# 埋め込みの «A post shared by 名前 (@handle)» / «名前(@handle)がシェアした投稿» から handle を採る
RE_AT = re.compile(r"[(（]@([A-Za-z0-9._]{2,30})[)）]")
# 埋め込みの定型文（キャプションではない）
BOILER = re.compile(
    r"^(view this post on instagram|この投稿をinstagramで見る|在\s*instagram\s*查看這則貼文|"
    r"instagram で.*を見る|follow me!?|追蹤|フォロー|see more|もっと見る|https?://)",
    re.IGNORECASE)
RE_SHARED = re.compile(r"(がシェアした投稿|分享的貼文|a post shared by|share[dz] a post)", re.IGNORECASE)


def _open(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)


def _host_of(uri: str) -> str:
    try:
        h = uri.split("/")[2].lower()
    except Exception:  # noqa: BLE001 - 壊れた URI は捨てる
        return ""
    if h.startswith("www."):
        h = h[4:]
    return h.split(":")[0]


def _coverage(pipeline: BigQueryPipeline, crawl: str) -> list[dict]:
    """その crawl で «すでに読んだ» ラウンドの記録（唯一の正）。

    `restaurant_pipeline_runs` の `parameters_json` が durable な記録である
    （台帳はコンテナと一緒に消える）。失敗した run は読めていない前提で外す。
    """
    from google.cloud import bigquery
    sql = f"""
      SELECT CAST(JSON_VALUE(parameters_json, '$.shards') AS INT64) AS shards,
             CAST(JSON_VALUE(parameters_json, '$.shard') AS INT64) AS shard,
             CAST(JSON_VALUE(parameters_json, '$.skip_files') AS INT64) AS skip_files,
             CAST(JSON_VALUE(parameters_json, '$.files') AS INT64) AS files,
             CAST(JSON_VALUE(parameters_json, '$.files_read') AS INT64) AS files_read
      FROM `{pipeline.table('restaurant_pipeline_runs')}`
      WHERE started_at >= TIMESTAMP('2026-01-01')
        AND step_name = '4_9_scan_cc_wat_instagram'
        AND status = 'succeeded'
        AND JSON_VALUE(parameters_json, '$.crawl') = @crawl
    """
    params = [bigquery.ScalarQueryParameter("crawl", "STRING", crawl)]
    return [dict(r) for r in pipeline.execute(sql, params)]


def _store_hosts(pipeline: BigQueryPipeline, catalog_run_id: str) -> dict[str, str]:
    """カタログ店の website ホスト → google_place_id。

    ⚠️ 判定は `common_sns.store_site_host_sql` が唯一の正（7_5 が天井を数えるのに
    同じ辞書を引く）。ここへ写経しないこと。
    """
    sql = store_site_host_sql(pipeline.table('restaurant_catalog'))
    from google.cloud import bigquery
    params = [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)]
    return {r["host"]: r["place_id"] for r in pipeline.execute(sql, params)}


def _cities(pipeline: BigQueryPipeline, catalog_run_id: str):
    """市区町村→座標の索引。判定そのものは common_sns（唯一の正）に置く。

    実測（WAT 2 本）: 日本語ページの 36% がタイトル/説明に市区町村名を持ち、
    そのページが投稿の 39% を抱えている。素の Instagram キャプションが住所を持つのは 0.6% で、
    ソースページの地域が «どこの店か» の唯一の手掛かりになる。
    """
    from google.cloud import bigquery
    rows = pipeline.execute(city_index_sql(pipeline.table("restaurant_catalog")),
                            [bigquery.ScalarQueryParameter("crid", "STRING", catalog_run_id)])
    return build_city_index(rows)


def _page_meta(hm: dict) -> tuple[str, str]:
    head = hm.get("Head") or {}
    title = (head.get("Title") or "").strip()
    desc = ""
    for m in head.get("Metas") or []:
        name = (m.get("name") or m.get("property") or "").lower()
        if name in ("description", "og:description") and not desc:
            desc = (m.get("content") or "").strip()
    return title, desc


def _pick(texts: list[str]) -> tuple[str | None, str | None]:
    """アンカーテキスト群から (キャプション, handle) を選ぶ。"""
    handle = None
    caption = None
    for t in texts:
        m = RE_AT.search(t)
        if m and not handle:
            h = m.group(1).lower()
            if h not in RESERVED:
                handle = h
        if BOILER.match(t) or RE_SHARED.search(t):
            continue  # 定型文・«◯◯がシェアした投稿» は本文ではない
        if len(t) < 8:
            continue
        if caption is None or len(t) > len(caption):
            caption = t
    return caption, handle


def scan_record(raw: bytes, store_hosts: dict[str, str], by_pair, uniq):
    """WAT 1 レコードから (post_id -> row素材) を返す。"""
    try:
        rec = json.loads(raw)
    except Exception:  # noqa: BLE001 - 壊れた JSON は捨てる
        return {}, set()
    env = rec.get("Envelope") or {}
    uri = (env.get("WARC-Header-Metadata") or {}).get("WARC-Target-URI") or ""
    hm = ((env.get("Payload-Metadata") or {}).get("HTTP-Response-Metadata") or {}).get("HTML-Metadata") or {}
    links = hm.get("Links") or []
    if not links:
        return {}, set()

    host = _host_of(uri)
    place_id = store_hosts.get(host)
    title, desc = _page_meta(hm)

    by_code: dict[str, list[str]] = {}
    handle_of: dict[str, str] = {}
    # 埋め込みから採れた handle だけを在庫に足す。«埋め込まれる投稿を実際に持っている»
    # ことが確認できたアカウントなので、素のプロフィールURLより桁で質が高い。
    profiles: set[str] = set()
    for ln in links:
        u = ln.get("url") or ""
        if "instagram.com" not in u:
            continue
        m = RE_IG_POST.search(u)
        if not m:
            continue  # 素のプロフィールURLは採らない（1本あたり 4,225 件出て、その殆どが
                      # «日本のページに貼られただけの誰か» である。handle 在庫は既に過剰で、
                      # 足りないのは投稿の方なので、ここで増やしても詰まりが悪化するだけ）
        code = m.group(2)
        if m.group(1) and m.group(1).lower() not in RESERVED:
            handle_of.setdefault(code, m.group(1).lower())
        for t in ((ln.get("text") or "").strip(), (ln.get("title") or "").strip()):
            if t:
                by_code.setdefault(code, []).append(t)
        by_code.setdefault(code, [])

    if not by_code:
        return {}, profiles

    # ページ全体のタイトルをフォールバックに使ってよいのは «その投稿の記事» のときだけ。
    # 多数の投稿を並べる一覧ページに同じタイトルを配ると、resolve に嘘を食わせる。
    page_text = (title + " " + desc).strip()
    allow_page_fallback = len(by_code) <= 3 and bool(page_text)
    # 地点はページ（サイト）の属性なので、投稿数に関係なくそのページの全投稿へ当てる。
    # 店名と違って «一覧ページの 1 件目だけが正しい» という性質を持たない。
    area = area_from_text(page_text, by_pair, uniq)

    out: dict[str, dict] = {}
    for code, texts in by_code.items():
        caption, handle = _pick(texts)
        handle = handle or handle_of.get(code)
        # ページのタイトル＋説明を «場所の手掛かり» としてキャプションへ足す。
        # resolve が店を探せる地点は «渡された lat/lng» か «キャプション中の住所» の 2 つしか無く、
        # 素の Instagram キャプションは住所を持たないことが殆どである（実測 0.6%）。
        # 一方でソースページのタイトルは «【大阪市東成区】…｜号外NET 大阪市東成区・生野区» のように
        # 地域を書いていることが多く、これが唯一の «どこの店か» の手掛かりになる。
        # 一覧ページ（4 投稿以上）では投稿とページの内容が対応しないので足さない。
        if allow_page_fallback and page_text:
            caption = f"{caption} / {page_text}" if caption else page_text
        if not caption:
            continue  # キャプションが無い投稿URLは resolve が IG 取得に回るので採らない
        if not (place_id or host.endswith(".jp") or RE_KANA.search(caption)):
            continue  # 日本語でないページは捨てる（繁体字ブログが大量に混ざる）
        out[code] = {"caption": caption[:2000], "handle": handle, "host": host,
                     "place_id": place_id, "area": area}
        if handle:
            profiles.add(handle)
    return out, profiles


def scan_file(url: str, store_hosts: dict[str, str], by_pair, uniq):
    posts: dict[str, dict] = {}
    profiles: set[str] = set()
    seen_bytes = 0
    truncated = False
    try:
        with _open(url) as resp:
            gz = gzip.GzipFile(fileobj=resp)
            for raw in gz:
                seen_bytes += len(raw)
                if not raw.startswith(b'{"Container"') or b"instagram.com" not in raw:
                    continue
                got, prof = scan_record(raw, store_hosts, by_pair, uniq)
                profiles |= prof
                for code, row in got.items():
                    cur = posts.get(code)
                    # 同じ投稿が複数ページに出たら «キャプションが長い / 店が確定している» 方を採る
                    if cur is None or (row["place_id"] and not cur["place_id"]) or \
                       (row["area"] and not cur["area"]) or \
                       len(row["caption"]) > len(cur["caption"]):
                        posts[code] = row
    except (EOFError, OSError) as e:  # ストリーム断でも取れた分は使う
        LOGGER.warning("  stream ended early (%s) after %.0fMB", type(e).__name__, seen_bytes / 1048576)
        truncated = True
    return posts, profiles, seen_bytes, truncated


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Common Crawl WAT から Instagram 投稿URL＋キャプションを採る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--crawl", default="CC-MAIN-2026-34")
    p.add_argument("--catalog-run-id", default="restaurant-2026-08-23")
    p.add_argument("--shards", type=int, default=1, help="WAT ファイルの分割数")
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--max-files", type=int, default=200, help="このジョブで流す WAT 数")
    # ⚠️ #1947 **これが無いと «続きから» が撃てない。** シャードは毎回ストライプの先頭から
    #    取り直すので、`--shards/--shard` をどう変えても **必ず 0 番から**になる。
    #    2026-09-04 の 5 ラウンドが全部 0〜15,999 番に当たっていたのはこのためで、
    #    crawl 10 万本のうち **16.0% しか走査できていなかった**（残り 84% は未読のまま）。
    #    #1947 `auto` を既定にしないのは、既存の dispatch（数字を渡す）を壊さないため。
    #    ただし数字を渡したときも «もう読んだ範囲» なら止める（下の --allow-reread）。
    p.add_argument("--skip-files", default="0",
                   help="このシャードの先頭から読み飛ばす WAT 数（続きから流すため）。"
                        "`auto` で «まだ読んでいない窓» を記録から自分で決める")
    # ⚠️ #1947 2026-10-01、読み終わった crawl へ skip 0/500/1000 を投げ直して
    #    約 25 レーン時間を捨てた（新規投稿 2.9%）。しかも run は緑だった。
    #    «もう読んだ範囲» を投げたら止める。意図して読み直すときだけこれを付ける。
    p.add_argument("--allow-reread", action="store_true",
                   help="すでに読んだ範囲でも読み直す（既定は止める）")
    p.add_argument("--flush-every", type=int, default=10, help="何ファイルごとに BQ へ流すか")
    # ⚠️ #1947 GitHub の job 上限は 360 分で、**そこで殺されると «完了» の行が出ない**。
    #    2,000 file の 1 シャードは 199 → 228 → 240 分と伸びていて（2026-09-27 実測）、
    #    いずれ上限に当たる。当たった run は «赤» になり、何本読めたのかも分からなくなる
    #    （行は --flush-every ごとに入っているので失われないが、報告に使えない）。
    #    自分で締め切りを持って «途中までの結果» を出して終わる。
    p.add_argument("--max-minutes", type=int, default=300,
                   help="この分数で打ち切る（GitHub の 360 分上限の手前で自分から降りる）")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()

    LOGGER.info("カタログの website ホストを読みます…")
    store_hosts = _store_hosts(pipeline, args.catalog_run_id)
    LOGGER.info("  店固有ホスト %d 件", len(store_hosts))
    by_pair, uniq = _cities(pipeline, args.catalog_run_id)
    LOGGER.info("  市区町村 %d 件（うち全国で一意 %d 件）", len(by_pair), len(uniq))

    with _open(f"{BASE}crawl-data/{args.crawl}/wat.paths.gz") as r:
        paths = [p for p in gzip.decompress(r.read()).decode().split("\n") if p.strip()]
    stripe_len = len([i for i in range(len(paths)) if i % max(args.shards, 1) == args.shard])
    already = already_read_indices(_coverage(pipeline, args.crawl))
    LOGGER.info("crawl %s: 全 %d ファイル中 **%d 本（%.1f%%）は既に読み終えています**"
                "（記録は restaurant_pipeline_runs）",
                args.crawl, len(paths), len(already), 100.0 * len(already) / max(len(paths), 1))

    if str(args.skip_files).lower() == "auto":
        auto = unread_skip(args.shards, args.shard, args.max_files, already, stripe_len)
        if auto is None:
            # ⚠️ **ここで赤くしない。** crawl を読み終わったのは異常ではなく «終わり» である。
            #   次にやることを名指しして 0 で降りる（collinfo.json に 128 crawl ある）。
            LOGGER.warning(
                "crawl %s の shard %d/%d は **読み終わっています**（未読の窓がありません）。"
                "次: 別の crawl を指定してください（`https://index.commoncrawl.org/collinfo.json` に "
                "128 crawl あり、採掘済みは CC-MAIN-2026-34 と CC-MAIN-2026-39 の 2 つだけ）",
                args.crawl, args.shard, args.shards)
            return
        LOGGER.info("--skip-files auto → %d（記録から «まだ読んでいない窓» を選びました）", auto)
        skip_files = auto
    else:
        skip_files = int(args.skip_files)

    mine = select_files(paths, shards=args.shards, shard=args.shard,
                        max_files=args.max_files, skip_files=skip_files)
    overlap = len(stripe_indices(args.shards, args.shard, skip_files, len(mine)) & already)
    if overlap and not args.allow_reread:
        # #1947 【設計】2026-10-01、読み終わった CC-MAIN-2026-34 へ skip 0/500/1000 を
        #   投げ直し、約 25 レーン時間で新規投稿 2.9%（82,938 → 2,440）しか出なかった。
        #   **run は緑で «成功» と出たので、気づいたのは翌日 BigQuery を数えたときである。**
        #   «仕事が無いのに黙って成功する» のが最悪なので、ここで止める。
        raise SystemExit(
            f"投げ直しです: crawl {args.crawl} shard {args.shard}/{args.shards} の "
            f"skip {skip_files}〜{skip_files + len(mine)} は {len(mine)} 本のうち "
            f"**{overlap} 本が既読**です（{100.0 * overlap / max(len(mine), 1):.0f}%）。"
            f"`--skip-files auto` で未読の窓へ進めるか、意図して読み直すなら "
            f"`--allow-reread` を付けてください")
    LOGGER.info("crawl %s: このシャードは %d 本中 %d 本（先頭 %d 本を読み飛ばし・既読の重なり %d 本）",
                args.crawl, stripe_len, len(mine), skip_files, overlap)

    # ⚠️ #1947 `parameters` は `step()` の `finally` で JSON 化されるので、**ここを
    #   走行中に書き換えると durable な記録に残る**。`files_read` を入れておかないと
    #   «--max-minutes で途中で降りた run» が «files 本ぜんぶ読んだ» ことになり、
    #   次のラウンドが未読のファイルを読み飛ばす。
    step_params = {
        # ⚠️ #1947 **`skip_files` を落とさないこと。** ここは «次はどこから流せばよいか» を
        #   後から復元できる唯一の durable な記録である（台帳はコンテナと一緒に消える）。
        #   2026-09-04 の 5 ラウンドは `files` と `shards/shard` しか残しておらず、
        #   「どの WAT を読んだのか」が 3 週間分からないままだった（実際は 16% だけ）。
        "crawl": args.crawl, "shards": args.shards, "shard": args.shard, "files": len(mine),
        "skip_files": skip_files, "total_files": len(paths),
        # 人が読むのはストライプ上の位置ではなく «crawl の何番目のファイルか» である。
        "file_index_range": _index_range(args.shards, args.shard, skip_files, len(mine)),
        "files_read": 0,
    }
    with pipeline.step(run_id, "4_9_scan_cc_wat_instagram",
                       parameters=step_params, repo_root=None) as result:
        rows: list[dict] = []
        acc_rows: list[dict] = []
        seen_posts: set[str] = set()
        seen_handles: set[str] = set()
        total_posts = total_seed = total_area = total_mb = 0

        def flush() -> None:
            nonlocal rows, acc_rows
            if rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_POST_RAW, rows)
            if acc_rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_SOURCE_ACCOUNT, acc_rows)
            rows, acc_rows = [], []

        # 1 ジョブ内のスレッド並列は測って捨てた: 単発 78MB/s に対し 6 並列で合計 46MB/s と
        # 遅くなる（回線が上限で、並べても増えない）。並列化はジョブ（=シャード）を増やす側でやる。
        deadline = time.monotonic() + args.max_minutes * 60
        # ⚠️ #1947 «何本で降りたか» を 0 で表すと `stopped_early or len(mine)` が
        #    **1 本目で降りた run を «全部読んだ» と報告する**（falsy な 0）。
        #    降りたかどうかはフラグで、本数は別の変数で持つ。
        stopped_early = False
        files_done = 0
        total_truncated = 0
        for n, path in enumerate(mine, 1):
            if time.monotonic() > deadline:
                stopped_early = True
                LOGGER.warning("--max-minutes %d に達したので %d/%d 本で降ります"
                               "（読んだぶんは BQ へ入っています）",
                               args.max_minutes, files_done, len(mine))
                break
            posts, profiles, nbytes, truncated = scan_file(BASE + path, store_hosts, by_pair, uniq)
            total_mb += nbytes / 1048576
            if truncated:
                total_truncated += 1
            for code, row in posts.items():
                if code in seen_posts:
                    continue
                seen_posts.add(code)
                total_posts += 1
                if row["place_id"]:
                    total_seed += 1
                if row["area"]:
                    total_area += 1
                rows.append({
                    "post_id": code, "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": f"https://www.instagram.com/p/{code}/",
                    "account_id": row["handle"], "discovery_route": "cc_wat",
                    "discovery_method": "cc_wat_embed", "discovery_query": row["host"],
                    "discovery_seed_place_id": row["place_id"],
                    "discovery_area_lat": row["area"][0] if row["area"] else None,
                    "discovery_area_lng": row["area"][1] if row["area"] else None,
                    "discovery_category_id": None,
                    "fetched_at": utc_now().isoformat(), "run_id": run_id,
                    "caption": row["caption"], "author_name": row["handle"],
                })
            for h in profiles:
                if h in seen_handles:
                    continue
                seen_handles.add(h)
                acc_rows.append({
                    "account_id": h, "provider": PROVIDER_INSTAGRAM, "handle": h,
                    "account_type": "unknown", "discovery_method": "cc_wat_profile",
                    "discovery_seed_place_id": None, "followers": None, "media_count": None,
                    "discovered_at": utc_now().isoformat(), "run_id": run_id,
                })
            files_done = n
            step_params["files_read"] = files_done
            if n % args.flush_every == 0:
                LOGGER.info("  %d/%d 本 | caption付き投稿 %d（店確定 %d / 地点あり %d） | handle %d | %.0fMB",
                            n, len(mine), total_posts, total_seed, total_area,
                            len(seen_handles), total_mb)
                flush()
        flush()
        result["row_count"] = total_posts
        result["seed_trusted"] = total_seed
        result["handles"] = len(seen_handles)
        result["with_area"] = total_area
        result["files_read"] = files_done
        result["files_truncated"] = total_truncated
        result["stopped_by"] = "max_minutes" if stopped_early else "all_files"
        LOGGER.info("%s: caption付き投稿 %d（店確定 %d / 地点あり %d）| handle %d | %.0fMB"
                    " | %d/%d 本",
                    "途中で降りました" if stopped_early else "完了",
                    total_posts, total_seed, total_area, len(seen_handles), total_mb,
                    files_done, len(mine))
        if total_truncated:
            LOGGER.warning("⚠️ **%d/%d 本は途中で切れています**（そのぶん収穫が落ちています）",
                           total_truncated, files_done)


if __name__ == "__main__":
    main()
