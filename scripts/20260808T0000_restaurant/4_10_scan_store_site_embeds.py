#!/usr/bin/env python3
"""#1273 柱1 の詰まりを business_discovery 無しで抜ける: 店の公式サイトに «埋め込まれている»
Instagram 投稿を、投稿URL＋キャプションごと採る。

## なぜこれが要るか（#1812）
4_4 のサイトクロールで «店固有 Instagram handle» が 52,131 店ぶん採れたが、
そのアカウントの投稿を集める手段が business_discovery（200コール/時 ≒ 全部で 200 時間）
しか無く、そこで詰まっている。

Instagram 公式の埋め込み blockquote は投稿本文をそのまま HTML に持つので、
**店のサイトをもう一度読むだけで «その店の投稿URL＋キャプション» が採れる**。
Instagram を一度も叩かない。しかも取れた投稿は «その店のサイトに載っていた» のだから
店が確定している（seed-trust）＝ resolve にはカテゴリだけ決めてもらえばよい。

CC WAT（4_9）と同じ仕掛けだが、あちらは «日本語のどこかのページ» が相手で店が不確かなのに対し、
こちらは最初から店が分かっている。取れる数は少なくても 1 件あたりの価値が違う。

## 使い方（db-script-run.yml）
  script_path: scripts/20260808T0000_restaurant/4_10_scan_store_site_embeds.py
  args: --run-id sns-2026-09-04-siteembed --site-run-id sns-2026-09-04-sitecrawl --shards 4 --shard 0
"""
from __future__ import annotations

import argparse
import html as html_mod
import logging
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from pathlib import Path

from pipeline_common import BigQueryPipeline, configure_logging, require_run_id, utc_now
from common_sns import PROVIDER_INSTAGRAM, TABLE_POST_RAW

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "1273_instagram_seed_poc"))
import pillar1_site_extract as p1  # noqa: E402  fetch / robots は 4_4 と同じものを使う（写経しない）

LOGGER = logging.getLogger(__name__)

RE_BLOCKQUOTE = re.compile(r"<blockquote[^>]*instagram-media.*?</blockquote>", re.S | re.I)
RE_PERMALINK = re.compile(r"instagram\.com/(?:[A-Za-z0-9._]{2,30}/)?(?:p|reel|tv)/([A-Za-z0-9_-]{5,20})", re.I)
RE_TAG = re.compile(r"<[^>]+>")
RE_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
RE_DESC = re.compile(r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\']([^"\']{0,400})', re.I)
RE_KANA = re.compile(r"[ぁ-んァ-ヴー]")
# 埋め込みの定型文はキャプションではない
BOILER = re.compile(r"(view this post on instagram|この投稿をinstagramで見る|"
                    r"がシェアした投稿|a post shared by|さんがシェアした投稿)", re.I)


# 日本の店サイトは Shift_JIS / EUC-JP がまだ多い。UTF-8 決め打ちで読むとキャプションが
# 丸ごと文字化けし、resolve が «カテゴリ不明» を返す（実測で skipped_no_category の一部が
# これだった）。宣言された charset を見てから、日本語で実際に使われる順に試す。
_RE_CHARSET = re.compile(rb'charset\s*=\s*["\']?\s*([A-Za-z0-9_\-]+)')
_ENC_ALIAS = {"shift_jis": "cp932", "shift-jis": "cp932", "sjis": "cp932", "x-sjis": "cp932",
              "windows-31j": "cp932", "ms932": "cp932", "euc-jp": "euc_jp"}


def _decode(raw: bytes) -> str:
    m = _RE_CHARSET.search(raw[:4096])
    declared = m.group(1).decode("ascii", "ignore").lower() if m else ""
    for cand in (_ENC_ALIAS.get(declared, declared), "utf-8", "cp932", "euc_jp"):
        if not cand:
            continue
        try:
            return raw.decode(cand)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


def _text(fragment: str) -> str:
    t = html_mod.unescape(RE_TAG.sub(" ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def _captions_from_html(raw: bytes) -> dict[str, str]:
    """HTML から {post_id: caption} を採る。公式 blockquote が本命。"""
    text = _decode(raw)
    out: dict[str, str] = {}
    for bq in RE_BLOCKQUOTE.findall(text):
        m = RE_PERMALINK.search(bq)
        if not m:
            continue
        body = _text(bq)
        # 定型文だけの行を落として、残った最長の塊を本文とみなす
        parts = [p.strip() for p in re.split(r"\s{2,}|｜|\|", body) if p.strip()]
        cand = [p for p in parts if not BOILER.search(p) and len(p) >= 8]
        cap = max(cand, key=len) if cand else ""
        if cap:
            out[m.group(1)] = cap[:2000]
        else:
            out.setdefault(m.group(1), "")
    # blockquote の外に素で貼られている permalink も拾う（キャプションは無い）
    for m in RE_PERMALINK.finditer(text):
        out.setdefault(m.group(1), "")
    return out


def _page_text(raw: bytes) -> str:
    text = _decode(raw)
    t = RE_TITLE.search(text)
    d = RE_DESC.search(text)
    return (_text(t.group(1)) if t else "") + " " + (html_mod.unescape(d.group(1)) if d else "")


def scan_store(store: dict, per_store: int = 10) -> list[dict]:
    url = (store.get("website") or "").strip()
    if not url or not url.startswith("http"):
        return []
    if not p1.robots_allows(url):
        return []
    raw, err = p1.fetch(url)
    if raw is None:
        return []
    caps = _captions_from_html(raw)
    if not caps:
        return []
    page = _page_text(raw).strip()
    rows = []
    # 本物の埋め込みキャプションを持つものを先に、ページタイトル頼りのものを後に。
    # 後者は同じ文が全投稿に付くので、resolve へ何十件も流しても同じ答えしか返らない。
    ordered = sorted(caps.items(), key=lambda kv: -len(kv[1]))[:max(per_store, 1)]
    used_page_text = False
    for code, cap in ordered:
        # キャプションが取れない投稿には、ページのタイトル＋説明を当てる。
        # 店は既に確定しているので、ここは «カテゴリを決める手掛かり» を渡すためのもの。
        if cap:
            caption = cap
        else:
            # 埋め込みキャプションが無い投稿はページの文言で代用するが、同じ文を
            # 何十件も resolve へ流しても同じ答えしか返らない。1 店 1 件に絞る。
            if used_page_text or not page:
                continue
            used_page_text = True
            caption = page
        rows.append({"post_id": code, "caption": caption[:2000] or None,
                     "place_id": store["google_place_id"], "handle": store.get("handle"),
                     "host": store.get("host")})
    return rows


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="店の公式サイトに埋め込まれた Instagram 投稿を採る")
    p.add_argument("--run-id", default=None)
    p.add_argument("--site-run-id", default="sns-2026-09-04-sitecrawl",
                   help="読む sns_store_site_ig の run_id")
    p.add_argument("--shards", type=int, default=1)
    p.add_argument("--shard", type=int, default=0)
    p.add_argument("--limit", type=int, default=0, help="0 なら全件")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--flush-every", type=int, default=500)
    # 既定は «handle が採れた店»。no_handle は «サイトは読めたが Instagram の handle が
    # 見つからなかった» 店で 84,752 件ある。handle が無くても投稿の埋め込みだけはある
    # ことがあるので、別ジョブで拾えるようにする。
    p.add_argument("--statuses", default="ok",
                   help="対象にする sns_store_site_ig.status（カンマ区切り。例: ok,no_handle）")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def _read_stores(pipeline: BigQueryPipeline, site_run_id: str, shards: int, shard: int, limit: int,
                 statuses: list[str]):
    shard_filter = "AND MOD(ABS(FARM_FINGERPRINT(google_place_id)), @shards) = @shard" if shards > 1 else ""
    sql = f"""
      SELECT google_place_id, ANY_VALUE(website) website, ANY_VALUE(host) host,
             ANY_VALUE(handle) handle
      FROM `{pipeline.table('sns_store_site_ig')}`
      WHERE run_id = @srid AND status IN UNNEST(@statuses)
        AND website IS NOT NULL AND website != '' {shard_filter}
      GROUP BY google_place_id
      {f'LIMIT {int(limit)}' if limit else ''}
    """
    from google.cloud import bigquery
    params = [bigquery.ScalarQueryParameter("srid", "STRING", site_run_id),
              bigquery.ArrayQueryParameter("statuses", "STRING", statuses)]
    if shards > 1:
        params += [bigquery.ScalarQueryParameter("shards", "INT64", shards),
                   bigquery.ScalarQueryParameter("shard", "INT64", shard)]
    return [dict(r) for r in pipeline.execute(sql, params)]


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()

    statuses = [x.strip() for x in args.statuses.split(",") if x.strip()]
    stores = _read_stores(pipeline, args.site_run_id, args.shards, args.shard, args.limit, statuses)
    LOGGER.info("対象 %d 店（site_run_id=%s, shard=%d/%d）", len(stores), args.site_run_id,
                args.shard, args.shards)

    with pipeline.step(run_id, "4_10_scan_store_site_embeds", parameters={
        "site_run_id": args.site_run_id, "shards": args.shards, "shard": args.shard,
        "statuses": args.statuses, "stores": len(stores),
    }, repo_root=None) as result:
        now = utc_now().astimezone(timezone.utc).isoformat()
        rows: list[dict] = []
        seen: set[str] = set()
        total = with_caption = hit_stores = 0

        def flush() -> None:
            nonlocal rows
            if rows and not args.dry_run:
                pipeline.load_json_rows(TABLE_POST_RAW, rows)
            rows = []

        pool = ThreadPoolExecutor(max_workers=max(args.workers, 1))
        for n, found in enumerate(pool.map(scan_store, stores), 1):
            if found:
                hit_stores += 1
            for r in found:
                if r["post_id"] in seen:
                    continue
                seen.add(r["post_id"])
                total += 1
                if r["caption"]:
                    with_caption += 1
                rows.append({
                    "post_id": r["post_id"], "provider": PROVIDER_INSTAGRAM,
                    "canonical_url": f"https://www.instagram.com/p/{r['post_id']}/",
                    "account_id": r["handle"], "discovery_route": "store_site_embed",
                    "discovery_method": "store_site_embed", "discovery_query": r["host"],
                    "discovery_seed_place_id": r["place_id"], "discovery_area_lat": None,
                    "discovery_area_lng": None, "discovery_category_id": None,
                    "fetched_at": now, "run_id": run_id,
                    "caption": r["caption"], "author_name": r["handle"],
                })
            if n % args.flush_every == 0:
                LOGGER.info("  %d/%d 店 | 投稿 %d（caption付き %d） | 当たった店 %d",
                            n, len(stores), total, with_caption, hit_stores)
                flush()
        flush()
        result["row_count"] = total
        result["with_caption"] = with_caption
        result["hit_stores"] = hit_stores
        LOGGER.info("完了: 投稿 %d（caption付き %d）| 当たった店 %d / %d",
                    total, with_caption, hit_stores, len(stores))


if __name__ == "__main__":
    main()
