#!/usr/bin/env python3
"""#1273 施設サイトのテナント紹介ページに、実際に料理写真があるか（実効の測定）

## 位置づけ

`measure_facility_tenant.py` は**母集団側の規模だけ**を出した（経路存在率の分母）。
本スクリプトは残り半分、**「施設サイトを引くと料理写真が本当に出てくるか」**を測る。
この2つを掛けないと実効カバレッジにならない。

## 規約（先に確認した）

3社の `robots.txt` を実際に引いて確認した（2026-08-14）:

  - www.aeonmall.com      : Disallow は /wp/wp-admin/ のみ。sitemap 公開。
  - mitsui-shopping-park.com : Disallow は /ec/ 検索系と /spn/ 等。店舗ページは対象外。sitemap 公開。
  - www.atre.co.jp        : Disallow は js/pdf の一部のみ。

**いずれもテナント紹介ページの取得を禁じていない**。加えて sitemap を自ら公開しており、
機械的な発見を想定している。取得は**直列・1.2秒間隔**にして負荷をかけない。
robots.txt が Disallow しているパスには**一切触れない**（下の `robots_denied` で弾く）。

## 段階

    --stage discover : sitemap から店舗ページの URL を集めて数える
    --stage fetch    : 決定的に標本を抜いて取得し、画像 URL を抽出する
    --stage download : 抽出した画像を落として目視用に並べる

**目視をしていない段階で「料理写真がある」と言わない。** `og:image` は
ロゴや外観のことが多い、というのは①で既に実測している。

実行:
    python3 measure_facility_photo.py --stage discover
    python3 measure_facility_photo.py --stage fetch --sample 60
    python3 measure_facility_photo.py --stage download
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
IMG_DIR = OUT_DIR / "facility_photo_images"

UA = "Mozilla/5.0 (compatible; nanitabeyo-research/1.0)"
DELAY = 1.2
TIMEOUT = 30

# --- 何を測るか、なぜこの事業者か ------------------------------------------
#
# 【実測して分かったこと（2026-08-14）】
#
#  - `www.aeonmall.com` の sitemap には**モールの一覧しか無く**、テナントページは
#    各モールの独自ドメイン（例 makuharishintoshin-aeonmall.com）にある。
#    そのモール個別サイトは **Nuxt の SPA** で、HTML には店舗リンクが1本も無い
#    （`/shop/` を引いても `_nuxt/*.js` しか出てこない）。JSON API を特定しないと
#    取れない。**別の問題なので本スクリプトでは扱わない。**
#  - `www.atre.co.jp/sitemap.xml` は 404。
#  - `mitsui-shopping-park.com` の ららぽーとは**サーバ側でHTMLを描いており**、
#    `/shopguide/` 一覧に各テナントの `/shopguide/<id>.html` が並ぶ。
#    テナントページには `og:image` と `/shopguide/<id>/imageN.jpg` がある。
#    → **ここだけが今すぐ測れる**ので、ららぽーとで実効を確定させる。
#
# sitemap.xml の URL は古く 404 を返した（`700260.html` が 404）。
# **一覧ページから生きたリンクを取る**方式に変えた。
OPERATORS = {
    "lalaport": {
        # robots.txt が sitemap を公開している館を使う。館ごとに一覧ページを引く。
        "indexes": tuple(
            f"https://mitsui-shopping-park.com/lalaport/{m}/shopguide/"
            for m in ("tokyo-bay", "yokohama", "toyosu", "kashiwa",
                      "shinmisato", "fujimi", "ebina")
        ),
        "shop_re": re.compile(r"/shopguide/\d+\.html$"),
        # robots.txt の Disallow をそのまま持つ。触れない。
        "robots_denied": (re.compile(r"^/ec/sp/"), re.compile(r"^/ec/facility/items/"),
                          re.compile(r"^/spn/"), re.compile(r"^/urban/pc/"),
                          re.compile(r"/redirect/"),
                          re.compile(r"^/mop/.*/search/"), re.compile(r"^/mop/search/"),
                          re.compile(r"^/lalaport/.*/gt/")),
    },
}

_LOC = re.compile(rb"<loc>\s*([^<\s]+)\s*</loc>", re.I)
_HREF = re.compile(rb'href=["\']([^"\'#]+)["\']', re.I)
_OG = re.compile(rb'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
                 re.I)
_OG2 = re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image',
                  re.I)
_IMG = re.compile(rb'<img[^>]+src=["\']([^"\']+)["\']', re.I)
_TITLE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


def get(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
        if url.endswith(".gz") or body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return body
    except Exception as e:                                   # noqa: BLE001
        print(f"    ! {type(e).__name__} {url[:90]}", file=sys.stderr)
        return None


def denied(op: dict, url: str) -> bool:
    path = urllib.parse.urlparse(url).path
    return any(p.search(path) for p in op["robots_denied"])


def stage_discover(args) -> None:
    out = {}
    for name, op in OPERATORS.items():
        print(f"\n=== {name} ===", file=sys.stderr)
        shops: set[str] = set()
        for idx in op["indexes"]:
            body = get(idx)
            time.sleep(DELAY)
            if not body:
                continue
            before = len(shops)
            for m in _HREF.findall(body):
                loc = urllib.parse.urljoin(idx, m.decode("utf-8", "replace"))
                if op["shop_re"].search(loc) and not denied(op, loc):
                    shops.add(loc)
            print(f"  {idx[:74]:76} +{len(shops) - before:>5}  累計 {len(shops):>6}",
                  file=sys.stderr)
        out[name] = sorted(shops)
        print(f"  -> 店舗ページ候補 {len(shops):,}（一覧 {len(op['indexes'])} 館）",
              file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / "facility_photo_urls.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {p.name}  合計 {sum(len(v) for v in out.values()):,} URL",
          file=sys.stderr)


# 館のテナントは大半が物販なので、飲食かどうかを分ける。
#
# 【自戒】最初は「屋号＋本文先頭1500字に料理語があるか」で判定した。
# **クリーニング店もスーツ店も全部『食』になった。**館の共通ナビに
# 「フード / レストラン」が入っているためで、本文を眺めるやり方では
# 全店が飲食判定になる。**100% という有り得ない数字が出て気付いた。**
#
# ページには `<dt class="ico-category">カテゴリー</dt><dd>…</dd>` という
# **館が付けた業種フィールド**がある（例「ファッション / ファッション・雑貨」
# 「フード / レストラン」）。判定はこの1フィールドだけを見る。
_CATEGORY_FIELD = re.compile(
    rb'<dt[^>]*class="[^"]*ico-category[^"]*"[^>]*>.*?<dd[^>]*>(.*?)</dd>',
    re.I | re.S)
_FOOD_GENRE = re.compile(
    r"フード|レストラン|カフェ|飲食|グルメ|スイーツ|食品|食物販|ベーカリー")
_TAG = re.compile(rb"<[^>]+>")


def visible_text(body: bytes) -> str:
    s = re.sub(rb"<(script|style)[^>]*>.*?</\1>", b" ", body, flags=re.I | re.S)
    return _TAG.sub(b" ", s).decode("utf-8", "replace")


def genre_of(body: bytes) -> str:
    m = _CATEGORY_FIELD.search(body)
    if not m:
        return ""
    return " ".join(_TAG.sub(b" ", m.group(1)).decode("utf-8", "replace").split())


def stage_fetch(args) -> None:
    src = OUT_DIR / "facility_photo_urls.json"
    if not src.exists():
        raise SystemExit("先に --stage discover を実行する")
    urls = json.loads(src.read_text(encoding="utf-8"))

    rows = []
    for name, lst in urls.items():
        if not lst:
            continue
        ordered = sorted(lst, key=lambda u: hashlib.sha256(u.encode()).hexdigest())
        take = ordered[: args.sample]
        print(f"\n=== {name}: {len(lst):,} から {len(take)} 件を抜く（SHA-256順）===",
              file=sys.stderr)
        for u in take:
            body = get(u)
            time.sleep(DELAY)
            if not body:
                rows.append({"operator": name, "url": u, "ok": False})
                continue
            t = _TITLE.search(body)
            title = t.group(1).decode("utf-8", "replace").strip()[:120] if t else ""
            if "not found" in title.lower():
                rows.append({"operator": name, "url": u, "ok": False,
                             "reason": "404"})
                print(f"  ! 404 {u[-24:]}", file=sys.stderr)
                continue

            def absolutize(s: str) -> str:
                return urllib.parse.urljoin(u, s)

            genre = genre_of(body)
            hit = _FOOD_GENRE.search(genre) if genre else None

            og = _OG.search(body) or _OG2.search(body)
            imgs = [absolutize(m.decode("utf-8", "replace"))
                    for m in _IMG.findall(body)]
            # 館の共通素材（ロゴ・アイコン・バナー）と、ページ下部の
            # 「他の店舗」枠（/shopguide/<別ID>/）を落とす
            page_id = re.search(r"/(\d+)\.html$", u)
            pid = page_id.group(1) if page_id else ""
            own = []
            for i in imgs:
                if re.search(r"logo|icon|banner|sprite|/common/|blank|dummy", i, re.I):
                    continue
                other = re.search(r"/shopguide/(\d+)/", i)
                if other and pid and other.group(1) != pid:
                    continue
                own.append(i)

            rows.append({
                "operator": name, "url": u, "ok": True, "title": title,
                "genre": genre, "is_food": bool(hit),
                "og_image": (absolutize(og.group(1).decode("utf-8", "replace"))
                             if og else None),
                "n_img": len(own), "images": own[:12],
            })
            print(f"  {title[:30]:32} {genre[:22]:24} {'食' if hit else '  '} "
                  f"img {len(own):>3} og {'y' if og else 'n'}", file=sys.stderr)

    ok = [r for r in rows if r.get("ok")]
    food = [r for r in ok if r.get("is_food")]
    food_img = [r for r in food if r["n_img"] > 0 or r.get("og_image")]
    print(f"\n取得できた {len(ok)}/{len(rows)}", file=sys.stderr)
    print(f"  うち飲食と判定 {len(food)} = {len(food) / max(len(ok), 1) * 100:.1f}%",
          file=sys.stderr)
    print(f"  飲食のうち画像URLがある {len(food_img)} = "
          f"{len(food_img) / max(len(food), 1) * 100:.1f}%", file=sys.stderr)
    print("  ※ ここまでは**画像URLの有無**。料理写真かどうかは目視で決める。"
          "og:image がロゴ・外観のことが多いのは①で実測済み。", file=sys.stderr)

    p = OUT_DIR / "facility_photo_pages.json"
    p.write_text(json.dumps({"rows": rows, "n_ok": len(ok), "n_food": len(food),
                             "n_food_with_img": len(food_img),
                             "caveat": "画像URLの有無であって料理写真の有無ではない。"
                                       "飲食判定は屋号＋本文先頭1500字の業種表記。"},
                            ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {p.name}", file=sys.stderr)


def stage_download(args) -> None:
    src = OUT_DIR / "facility_photo_pages.json"
    if not src.exists():
        raise SystemExit("先に --stage fetch を実行する")
    rows = json.loads(src.read_text(encoding="utf-8"))["rows"]
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for r in rows:
        # 飲食テナントだけ落とす。館そのもののページ（屋号＝館名）は除く。
        if not r.get("ok") or not r.get("is_food"):
            continue
        shop = (r.get("title") or "").split("|")[0].strip()
        mall = (r.get("title") or "").split("|")[-1].strip()
        if shop and shop == mall:
            continue
        cands = ([r["og_image"]] if r.get("og_image") else []) + (r.get("images") or [])
        for i, u in enumerate(cands[: args.per_page]):
            h = hashlib.sha256(u.encode()).hexdigest()[:12]
            ext = ".jpg"
            for e in (".png", ".webp", ".gif", ".jpeg", ".jpg"):
                if e in u.lower():
                    ext = e
                    break
            path = IMG_DIR / f"{r['operator']}_{h}{ext}"
            if not path.exists():
                body = get(u)
                time.sleep(DELAY)
                if not body or len(body) < 2000:
                    continue
                path.write_bytes(body)
            saved.append({"file": path.name, "page": r["url"],
                          "title": r.get("title", ""), "img": u, "rank": i})
    p = OUT_DIR / "facility_photo_downloaded.json"
    p.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n落とした画像 {len(saved)} 枚 -> {IMG_DIR.name}/", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="#1273 施設サイトの料理写真の実効測定")
    ap.add_argument("--stage", choices=("discover", "fetch", "download"),
                    required=True)
    ap.add_argument("--sample", type=int, default=60)
    ap.add_argument("--max-sitemaps", type=int, default=40)
    ap.add_argument("--per-page", type=int, default=3)
    args = ap.parse_args()
    {"discover": stage_discover, "fetch": stage_fetch,
     "download": stage_download}[args.stage](args)


if __name__ == "__main__":
    main()
