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




# ---------------------------------------------------------------------------
# 記事本文から «店名» を切り出す（#1812 経路C）
#
# 日本のローカルグルメ媒体の見出しは «【市区町村】…「店名」…» の形で、
# 【】は市区町村、『』「」が店名という書き分けがほぼ守られている。
#
# 切り出した店名は `sns_post_raw.author_name` へ入れる。resolve はこれを
# 店名クエリ（`q`）としてエリア内検索に投げるので、エリアの候補上限（100 件）に
# 埋もれた個人店でも名指しで引ける。**resolve 側は一切変えなくてよい。**
#
# 実測（経路C の投稿 400 件・5km 以内のカタログ店と突合）:
#   『』のみ 18 件 / 「」のみ 57 件 / どちらか 75 件（18.8%）
#   現在の matched は 2.1% なので、ここが取り切れれば桁で変わる。
# ---------------------------------------------------------------------------

_RE_QUOTED = re.compile(r"[『「]([^』」]{2,30})[』」]")
# 店名ではないことが字面で分かるもの。文になっている／日付や告知の常套句。
_RE_NOT_NAME = re.compile(r"[。！？!?]|です|ます|しました|ください|でした|とは$|^\d+$")
_NAME_STOPWORDS = frozenset({
    "営業時間", "定休日", "アクセス", "メニュー", "予約", "駐車場", "テイクアウト",
    "新型コロナウイルス", "こどもの日", "母の日", "父の日", "バレンタイン", "ハロウィン",
})


def store_name_from_text(text: str) -> str | None:
    """記事の文言から、店名として最も確からしい 1 つを返す。

    『』を「」より優先する（媒体は店名に『』を使う傾向が強く、「」は普通の引用にも使う）。
    同じ括弧の中では長い方を採る。文になっているもの・行事名は捨てる。
    """
    if not text:
        return None
    best: str | None = None
    best_rank = (-1, -1)
    for m in _RE_QUOTED.finditer(text):
        body = m.group(1).strip()
        if not body or body in _NAME_STOPWORDS or _RE_NOT_NAME.search(body):
            continue
        rank = (1 if text[m.start()] == "『" else 0, len(body))
        if rank > best_rank:
            best_rank, best = rank, body
    return best
