"""公式サイトを «相手に迷惑をかけずに» 取りに行くための共通部品。

## なぜ 1 ファイルに切り出してあるか

`6_2_measure_official_site_hours.py`（測るだけ）と
`6_3_crawl_official_site_hours.py`（測って DB へ書く）は、**同じサイトを同じ作法で
叩く**。robots.txt の扱い・UA・上限バイト数・文字コードの推定・分類の順序を
2 箇所に書くと、**片方だけ直したときに «測った数字» と «入れた行» がずれる**。

CLAUDE.md の「同じ判定を 2 箇所に書かない」に従って、判断を持つものは全部ここに置く。

## ⚠️ ここを変えると «測った数字» の意味が変わる

`classify_page` の分類は #1666 の実測（300 件）の分母そのものである。順序や条件を
変えたら、過去の数字と比較できなくなる。変えるときは #1666 へ «いつ何を変えたか» を
残すこと。

## 相手のサイトへの作法（変えないこと）

- robots.txt を必ず見る。**取れないときだけ «許可» とみなす**（置いていない = 制限なし）
- UA を名乗る。連絡先の URL を含める
- **再試行しない。** 落ちているサイトを二度叩かない
- トップページだけ。リンクを辿らない
"""

from __future__ import annotations

import re
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

from jp_site_opening_hours import is_japanese_text, parse_jp_site_opening_hours

USER_AGENT = "NanitabeyoResearchBot/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo; research)"
MAX_BYTES = 2_000_000  # 実測で生 HTML 1.4MB のサイトがあった。それが入る程度で頭打ちにする

# 「営業時間の話をしている」と読める語。`jp_site_opening_hours` の判定より **広く**取る。
# ここは «パーサが諦めただけで、人間なら読めた» を数えるための網なので、緩いほうが正しい。
#
# ⚠️ **ここにも `open` / `OPEN` という言語に依存しない語が入っている。**
#    `jp_site_opening_hours._OPENING_CONTEXT_RE` が同じ形で英語・韓国語ページを
#    通していたので、同じ欠陥が無いか当たり直した（#1666）。**この網は安全**である。
#    `classify_page` が先に `is_japanese_text` を通しており、非日本語ページはここへ
#    届かないため。**順序を入れ替えるとこの網が欠陥に変わる**ので入れ替えないこと。
_HOURS_MENTION_RE = re.compile(r"営業時間|営業日|定休日|休業日|open|OPEN|Open|ランチ|ディナー|開店|閉店")

# ⚠️ **日本語かどうかは «ページの中身» で決める。`country_code` を信用しない。**
#
# dry-run（run 33989897700）で `--country JP` を効かせたのに、韓国語のサイトが標本に
# 残った。座標まで出して確かめたところ、**それらは韓国にある店**だった:
#   파리바게뜨       (37.351, 126.742) 仁川   https://www.paris.co.kr/...
#   골뱅이가 따문 조개 (35.221, 128.684) 昌原   http://m.townspot.co.kr/...
#   식육 삼덕본점     (35.867, 128.602) 大邱   http://instagram.com/sikyuk_official
#
# つまり **`country_code = 'JP'` が誤っている**。原因は `3_4_build_restaurant_catalog.py`
# が **緯度経度の矩形**（lat 20.0-46.5 / lon 122.0-154.0）で国を決めていることで、
# この矩形には朝鮮半島もウラジオストクもまるごと入る。**これは別途起票する。**
#
# ⚠️ 国コードを直しても、この判定は要る。**日本にある韓国料理店**（国コードは正しく JP）の
#    韓国語サイトは残るし、日本の店の英語サイトもある。**国ではなくページの中身で決める。**
#
# ⚠️ 判定は `jp_site_opening_hours.is_japanese_text` を **そのまま使う**。同じ判断を
#    ここへ書き写すと、パーサ側だけ直したときに **この計測だけが古い基準で数え続ける**。


def classify_page(text: str) -> str:
    """到達できたページを 1 つの箱へ入れる。**ここが数字の意味を決める唯一の場所**である。

    `not_japanese_page` を先に見る。`parsed` / `mentions_hours_unparsed` /
    `no_hours_mentioned` は «日本語ページの中での内訳» であって、非日本語ページを
    混ぜると **命中率が薄まる**。

    ⚠️ 仮名だけで «日本語» を判定してはいけない。`営業時間 11:00-14:00 定休日 月曜` は
    **仮名を 1 文字も含まない日本語ページ**で、パーサは読める。`is_japanese_text` が
    その形を含めて判定するので、ここではそれを呼ぶだけにする。
    """
    if not is_japanese_text(text):
        return "not_japanese_page"
    if parse_jp_site_opening_hours(text) is not None:
        return "parsed"
    if _HOURS_MENTION_RE.search(text):
        return "mentions_hours_unparsed"
    return "no_hours_mentioned"


def html_to_text(html: str) -> str:
    """script / style / タグを落として本文だけにする。

    ⚠️ 依存を増やさないため正規表現で済ませている。**構造は見ていない**ので、
       «どのタグに書いてあるか» が要る用途にはそのまま流用しないこと。
    """
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<!--.*?-->", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return re.sub(r"\s+", " ", text).strip()


def to_ascii_url(url: str) -> str:
    """非 ASCII を含む URL を、そのまま送れる形へ直す。

    ⚠️ **これはこちらのバグを塞ぐためのもので、相手の都合ではない。**
    300 件の実測（run 33990366415）で `UnicodeEncodeError` が 1 件出た。HTTP の
    リクエスト行は ASCII なので、**ホスト名やパスに日本語が入っていると送信の時点で
    落ちる**。「到達できなかった」に数えていたが、**相手には 1 回も届いていない**。

    - ホスト名は IDNA（punycode）へ。`日本語.jp` → `xn--wgv71a119e.jp`
    - パス・クエリはパーセントエンコードへ

    ⚠️ `safe` に `%` を含めること。含めないと **すでにエンコード済みの URL を
    二重エンコードする**（実際の標本に `%e7%86%b1%e6%b5%b7%e5%ba%97` があり、
    `%25e7...` にすると 404 になる）。
    """
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    try:
        netloc = host.encode("idna").decode("ascii")
    except (UnicodeError, ValueError):
        # 空ラベル・アンダースコア入りなど IDNA にできないホスト。触らずに渡す
        netloc = host
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return urllib.parse.urlunsplit(
        (
            parts.scheme,
            netloc,
            urllib.parse.quote(parts.path, safe="/%~"),
            urllib.parse.quote(parts.query, safe="%=&?+;,:@!$'()*~"),
            "",  # フラグメントはサーバへ送らないので落とす
        )
    )


def fetch(url: str, timeout: float) -> tuple[str | None, str]:
    """(本文, 失敗理由) を返す。成功なら理由は空文字。**再試行しない。**"""
    req = urllib.request.Request(to_ascii_url(url), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            ctype = res.headers.get("Content-Type", "")
            if "html" not in ctype.lower():
                return None, f"not_html({ctype[:40]})"
            raw = res.read(MAX_BYTES)
        charset = None
        m = re.search(r"charset=([\w-]+)", ctype, re.I)
        if m:
            charset = m.group(1)
        if not charset:
            head = raw[:4096].decode("ascii", "ignore")
            m = re.search(r'charset=["\']?([\w-]+)', head, re.I)
            charset = m.group(1) if m else "utf-8"
        try:
            return raw.decode(charset, "replace"), ""
        except LookupError:
            return raw.decode("utf-8", "replace"), ""
    except urllib.error.HTTPError as e:
        return None, f"http_{e.code}"
    except urllib.error.URLError as e:
        return None, f"urlerror({str(e.reason)[:40]})"
    except Exception as e:  # noqa: BLE001 — 相手のサイトは何でも返してくる
        return None, f"{type(e).__name__}({str(e)[:40]})"


def robots_allows(url: str, cache: dict[str, urllib.robotparser.RobotFileParser | None], timeout: float) -> bool:
    """robots.txt を見て、この URL を取ってよいかを返す。

    ⚠️ **robots.txt 自体が取れないときは «許可» とみなす。** 取れない理由は
       «置いていない»（= 制限なし）が実測 10 件中 3 件あった。取れないことを禁止と
       読むと、制限を課していないサイトまで数から落ちて母数が歪む。
    """
    # ⚠️ ここも ASCII へ直す。**本文と robots.txt は同じホストを叩く**ので、
    #    片方だけ直すと «robots は取れないのに本文は取れる» というちぐはぐが起きる。
    parts = urllib.parse.urlsplit(to_ascii_url(url))
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{origin}/robots.txt")
        try:
            # urllib.robotparser は UA を名乗らないので自前で取りに行く
            req = urllib.request.Request(f"{origin}/robots.txt", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                rp.parse(res.read(200_000).decode("utf-8", "replace").splitlines())
            cache[origin] = rp
        except Exception:  # noqa: BLE001
            cache[origin] = None  # 取れなかった = 制限なしとして扱う
    rp = cache[origin]
    return True if rp is None else rp.can_fetch(USER_AGENT, to_ascii_url(url))
