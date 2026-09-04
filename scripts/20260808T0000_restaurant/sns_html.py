"""#1273 HTML から «Instagram 埋め込みの投稿URL＋キャプション» を採る共通部品。

Instagram 公式の埋め込み blockquote は投稿本文をそのままアンカーテキストとして持つので、
ページを読むだけで Instagram を一度も叩かずに (投稿URL, キャプション) が採れる。

4_10（店の公式サイト）と 4_12（日本のローカルグルメ媒体）が同じ抽出を使う。
**同じ判定を 2 箇所に書かないための置き場所**であって、ここに業務ロジックは置かない。
"""
from __future__ import annotations

import html as html_mod
import re

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


def decode_html(raw: bytes) -> str:
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


def strip_tags(fragment: str) -> str:
    t = html_mod.unescape(RE_TAG.sub(" ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def captions_from_html(raw: bytes) -> dict[str, str]:
    """HTML から {post_id: caption} を採る。公式 blockquote が本命。"""
    text = decode_html(raw)
    out: dict[str, str] = {}
    for bq in RE_BLOCKQUOTE.findall(text):
        m = RE_PERMALINK.search(bq)
        if not m:
            continue
        body = strip_tags(bq)
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


def page_text(raw: bytes) -> str:
    text = decode_html(raw)
    t = RE_TITLE.search(text)
    d = RE_DESC.search(text)
    return (strip_tags(t.group(1)) if t else "") + " " + (html_mod.unescape(d.group(1)) if d else "")


