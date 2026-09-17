#!/usr/bin/env python3
"""4つ目のソース: 自治体が公開している「食品営業許可施設一覧」を集める。

主KPI（Google Maps の飲食店をどれだけ拾えているか）の取りこぼしを調べたところ、
**名寄せの失敗ではなくオープンデータ側の欠落**だった（`gap_analysis.py`、
名前が分かる未到達 45 件のうち 44 件は最寄り行が別の店）。欠けていたのは
雑居ビルのテナントと繁華街のチェーン店である。

IFAS（食品衛生申請等システム）を既に使っているが、**IFAS には 2021年6月の
食品衛生法改正**以降にオンライン申請された分しか入っていない。許可は5〜8年で
更新されるので、改正前に許可を取った施設は順次入ってくるが、まだ大半が入っていない。
実測でも鹿児島市は IFAS 9,812 行に対し、改正前の台帳が別に 4,885 行ある。

改正前の台帳と、IFAS に載らない分は、**各自治体がオープンデータとして個別に公開
している**。BODIK（自治体共通のオープンデータ基盤）だけで「食品営業許可」の
データセットが 385 件ある。それを CKAN の API で拾って集める。

許可台帳には **階数まで入った住所**がある（例:「鹿児島市千日町15番15号4階」）。
Overture や OSM が持っていない、雑居ビルの上階テナントを取れるのはこれである。
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent

PORTALS = {
    # 全国のオープンデータを束ねる国のカタログ。「食品営業許可」で 18,141 件出る。
    "egov": "https://data.e-gov.go.jp/data",
    "bodik": "https://data.bodik.jp",
    "tokyo": "https://catalog.data.metro.tokyo.lg.jp",
}

QUERIES = ("食品営業許可", "食品等営業許可", "営業許可施設", "食品関係営業施設")
WANTED_FORMATS = {"CSV", "XLSX", "XLS"}
# CKAN の全文検索は語をばらして当てるので、「食品」「営業」だけで無関係な
# データセットが大量に釣れる（実測で 29,722 リソース、その大半が別物だった）。
# タイトルで許可台帳そのものに絞り込む。
KEEP = re.compile(r"(食品(等)?(関係)?(営業)?(許可|届出)|営業許可施設|飲食店営業|食品衛生.*(許可|台帳|施設))")
# 許可台帳ではないものを弾く。旅館・理美容・クリーニングも同じ「営業許可」で出てくる。
# 「〜施設数」のような統計表も落とす。件数だけで施設一覧ではない。
EXCLUDE = re.compile(
    r"旅館|理容|美容|クリーニング|興行場|公衆浴場|水道|プール|建築|墓地|産業廃棄物"
    r"|温泉|動物|薬局|医療|統計|件数|数$"
)
USER_AGENT = "nanitabeyo-open-data-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"


def fetch_json(url: str, *, timeout: float = 30.0) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def search(portal: str, query: str, *, rows: int = 1000) -> list[dict]:
    """CKAN の package_search を、件数分ページングして全部取る。"""

    found: list[dict] = []
    start = 0
    while True:
        url = (
            f"{portal}/api/3/action/package_search"
            f"?q={urllib.parse.quote(query)}&rows=100&start={start}"
        )
        try:
            payload = fetch_json(url)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"    ! {query} start={start}: {error}")
            break
        result = payload.get("result", {})
        batch = result.get("results", [])
        found.extend(batch)
        start += len(batch)
        if not batch or start >= min(result.get("count", 0), rows):
            break
        time.sleep(0.2)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portals", nargs="+", default=list(PORTALS))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "permits")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "permits_manifest.json")
    parser.add_argument("--municipalities", nargs="*",
                        help="指定するとその自治体名を含むものだけ落とす")
    parser.add_argument("--list-only", action="store_true")
    parser.add_argument("--from-manifest", type=Path,
                        help="列挙をやり直さず、既存の manifest から落とす")
    parser.add_argument("--max-bytes", type=int, default=200_000_000)
    arguments = parser.parse_args()

    seen: dict[str, dict] = {}
    if arguments.from_manifest:
        seen = {entry["url"]: entry for entry in json.loads(arguments.from_manifest.read_text())}
        arguments.portals = []
    for name in arguments.portals:
        portal = PORTALS.get(name, name)
        for query in QUERIES:
            packages = search(portal, query)
            print(f"  [{name}] {query}: {len(packages)} データセット", flush=True)
            for package in packages:
                title = package.get("title", "")
                if not KEEP.search(title) or EXCLUDE.search(title):
                    continue
                organisation = (package.get("organization") or {}).get("title", "")
                if arguments.municipalities and not any(
                    municipality in organisation + title
                    for municipality in arguments.municipalities
                ):
                    continue
                for resource in package.get("resources", []):
                    if (resource.get("format") or "").upper() not in WANTED_FORMATS:
                        continue
                    url = resource.get("url") or ""
                    if not url:
                        continue
                    seen[url] = {
                        "portal": name,
                        "organisation": organisation,
                        "dataset": title,
                        "resource": resource.get("name") or "",
                        "format": (resource.get("format") or "").upper(),
                        "url": url,
                    }

    print(f"\n候補リソース {len(seen):,} 件")
    arguments.manifest.parent.mkdir(parents=True, exist_ok=True)
    arguments.manifest.write_text(
        json.dumps(list(seen.values()), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if arguments.list_only:
        return 0

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    downloaded = failed = skipped = 0
    total_bytes = 0
    for index, entry in enumerate(seen.values(), 1):
        # ⚠️ 進捗ログは **ループの先頭**に置く。`continue` の後ろへ置くと
        #    «最後まで通った件» のときしか出ない。2026-09-06 の run 34022514117 は
        #    3,000 件で 6 行しか出ず、«前半 1,350 件で parsed が 1» を «前半が異常» と
        #    読み違える原因になった（実際は普通の並びだった）。
        if (index - 1) % 25 == 0 and index > 1:
            print(f"  {index - 1}/{len(seen)} 取得 {downloaded} 失敗 {failed} "
                  f"({total_bytes / 1e6:.0f}MB)", flush=True)
        stem = re.sub(r"[^0-9A-Za-z一-鿿ぁ-ヿ_.-]", "_", entry["organisation"])[:24]
        name = urllib.parse.unquote(entry["url"].rsplit("/", 1)[-1])[:96]
        target = arguments.output_dir / f"{stem}__{re.sub(r'[^0-9A-Za-z._-]', '_', name)}"
        if target.exists():
            skipped += 1
            continue
        try:
            request = urllib.request.Request(entry["url"], headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = response.read(arguments.max_bytes)
            target.write_bytes(payload)
            total_bytes += len(payload)
            downloaded += 1
        except Exception as error:  # noqa: BLE001 - 自治体のサーバは何を返すか分からない
            failed += 1
            print(f"    ! {entry['organisation']} {name}: {error}")

    print(json.dumps({"downloaded": downloaded, "skipped": skipped, "failed": failed,
                      "megabytes": round(total_bytes / 1e6, 1)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
