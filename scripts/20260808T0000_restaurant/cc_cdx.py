"""#1273 Common Crawl の URL index（CDX）を «あるホストのぶんだけ» 引く共通部品。

CDX は SURT（`com,example)/path`）の昇順に並んでいて、`cluster.idx` がその
ブロック索引になっている。つまり **あるホストの行は必ず連続している**ので、
cluster.idx を二分探索して当該ブロックだけ HTTP Range で取れば、
数百 GB の索引を全走査せずに «そのホストが CC に持っている URL 一覧» が採れる。

4_12（sitemap を持たない host の記事URLを採る）と 4_15（同一ドメインの
サブドメインを列挙する）が同じアクセスを使う。**同じ手順を 2 箇所に書かない**
ための置き場所であって、ここに «どの URL が記事か» のような業務判断は置かない。
"""
from __future__ import annotations

import bisect
import gzip
import io
import logging
import os
import subprocess
import urllib.request
from collections.abc import Iterator

LOGGER = logging.getLogger(__name__)

CC_BASE = "https://data.commoncrawl.org/"
UA = {"User-Agent": "nanitabeyo-research/1.0 (+dish_media seed; github.com/Ayato-kosaka/nanitabeyo)"}


def surt_prefix(domain: str) -> str:
    """`goguynet.jp` → `jp,goguynet`。カンマを含む文字列は SURT 前置とみなしてそのまま返す。"""
    d = domain.lower().strip(".")
    return d if "," in d else ",".join(reversed(d.split(".")))


def download(url: str, dest: str) -> bool:
    """大きいファイルを落とす。python の stream 読みはプロキシ経由で途中切断するので curl を使う。"""
    r = subprocess.run(["curl", "-sS", "--retry", "2", "--max-time", "900",
                        "-A", UA["User-Agent"], "-o", dest, url])
    return r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0


def range_get(url: str, rng: tuple[int, int] | None = None, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    if rng:
        req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_cluster_idx(crawl: str, cache_dir: str) -> list[list[str]]:
    """CDX の cluster.idx（SURT 昇順のブロック索引・約 100MB）を落として持つ。"""
    os.makedirs(cache_dir, exist_ok=True)
    dest = os.path.join(cache_dir, f"cluster_{crawl}.idx")
    if not os.path.exists(dest) or os.path.getsize(dest) == 0:
        LOGGER.info("cluster.idx を取得します（約 100MB）…")
        if not download(f"{CC_BASE}cc-index/collections/{crawl}/indexes/cluster.idx", dest):
            raise RuntimeError("cluster.idx の取得に失敗しました")
    return [ln.rstrip("\n").split("\t") for ln in open(dest, encoding="utf-8") if ln.strip()]


def iter_cdx_lines(prefix: str, rows: list[list[str]], keys: list[str], crawl: str,
                   max_blocks: int = 60, line_prefixes: tuple[str, ...] | None = None) -> Iterator[str]:
    """SURT 前置に一致する CDX の生行を順に返す。

    `prefix` はどのブロックを読むかを決める SURT 前置（`jp,goguynet` / `com,gurutto-`）。
    行の採否は `line_prefixes`（既定は `prefix` そのもの）で決める。ブロックの粒度と
    行の粒度を分けているのは、**ホスト 1 件に絞りたい場合と、サブドメイン網をまとめて
    採りたい場合で行の条件だけが変わる**ため。`)` は SURT のホスト終端記号なので、
    `jp,goguynet)` で切ればホスト 1 件、`jp,goguynet,` を足せばそのサブドメイン群になる。
    """
    line_prefixes = line_prefixes or (prefix,)
    lo = max(bisect.bisect_left(keys, prefix) - 1, 0)
    idx = f"{CC_BASE}cc-index/collections/{crawl}/indexes"
    for k, r in enumerate(rows[lo:lo + max_blocks]):
        if k and not r[0].startswith(prefix):
            break
        # 1 host が 1 ブロックにしか無いことは普通にあるので、取り損なうとその host が
        # 丸ごと «CDX に無い» ことになる（実測で IncompleteRead 1 回＝1 host 消滅）。1 回やり直す。
        text = None
        for attempt in range(2):
            try:
                raw = range_get(f"{idx}/{r[1]}", (int(r[2]), int(r[2]) + int(r[3]) - 1))
                text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
                break
            except Exception as e:  # noqa: BLE001 - 2 回とも駄目なら諦める
                LOGGER.warning("  ブロック取得に失敗（%d 回目）: %s", attempt + 1, str(e)[:60])
        if text is None:
            continue
        for line in text.splitlines():
            if line.split(" ", 1)[0].startswith(line_prefixes):
                yield line
