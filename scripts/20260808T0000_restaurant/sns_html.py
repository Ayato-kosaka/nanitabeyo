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


# 塊の切れ目は HTML の要素境界で取る。
#
# 【設計】以前は strip_tags したあと «2 つ以上の空白» で切っていたが、strip_tags は
# 空白の連続を 1 つに畳むので、この条件は**決して成立しない**。結果、キャプションと
# 末尾の定型文（"A post shared by …"）が 1 つの塊になり、BOILER に当たって
# **キャプションがまるごと捨てられていた**。経路B/C が投稿本文ではなくページタイトルで
# resolve していたのはこれが原因。要素境界で切れば両者は別の塊になる。
_RE_BLOCK_SPLIT = re.compile(r"(?:</p>|<br\s*/?>|</div>|</a>|</h[1-6]>)", re.I)


def captions_from_html(raw: bytes) -> dict[str, str]:
    """HTML から {post_id: caption} を採る。公式 blockquote が本命。"""
    text = decode_html(raw)
    out: dict[str, str] = {}
    for bq in RE_BLOCKQUOTE.findall(text):
        m = RE_PERMALINK.search(bq)
        if not m:
            continue
        # 定型文だけの塊を落として、残った最長の塊を本文とみなす
        parts: list[str] = []
        for chunk in _RE_BLOCK_SPLIT.split(bq):
            parts += [p.strip() for p in re.split(r"｜|\|", strip_tags(chunk)) if p.strip()]
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


# --- Instagram 公式の埋め込みページ（/embed/captioned/）専用 ---------------------
#
# ⚠️ `captions_from_html` は **第三者サイトが貼った blockquote** から採る関数で、
# 公式の埋め込みページには blockquote が無い。構造が違うので別の関数にする
# （4_14 で captions_from_html をそのまま使い、300 件取って 0 件だった）。
#
# 公式ページの本文は <div class="Caption"> の中で、先頭に投稿者 handle のリンク、
# 末尾に「N w」のような相対時刻が入る。どちらもキャプション本文ではないので落とす。
_RE_EMBED_CAPTION = re.compile(r'class="Caption"[^>]*>(.*?)</div>', re.S | re.I)
# ⚠️ アンカーは **タグ丸ごと**消す。属性だけを消すと `<a` が残り、strip_tags が
# 次の `>` までを 1 つのタグと見なして本文を食う（実測で先頭の一文が消えた）。
_RE_CAPTION_USERNAME = re.compile(r'<a[^>]*class="CaptionUsername"[^>]*>.*?</a>', re.S | re.I)
_RE_CAPTION_TIME = re.compile(r'<div class="CaptionComments".*', re.S | re.I)
_RE_TRAILING_AGE = re.compile(r"\s*\d+\s*[smhdwy]\s*$", re.I)


def caption_from_embed_html(raw: bytes) -> str | None:
    """`instagram.com/p/<code>/embed/captioned/` の HTML から本文を採る。無ければ None。"""
    text = decode_html(raw)
    m = _RE_EMBED_CAPTION.search(text)
    if not m:
        return None
    frag = m.group(1)
    frag = _RE_CAPTION_TIME.sub("", frag)
    frag = _RE_CAPTION_USERNAME.sub("", frag)
    body = strip_tags(frag).strip()
    body = _RE_TRAILING_AGE.sub("", body).strip()
    if not body or BOILER.search(body):
        return None
    return body[:2000]


# 埋め込みの投稿者 handle は 2 か所に出る。定型文の «(@handle)» と、
# プロフィールへのリンク «instagram.com/<handle>/?utm_source=ig_embed»。
# permalink（/p/<code>/）と紛れるので、あとに /p/ /reel/ /tv/ が続かないものだけを採る。
_RE_AT = re.compile(r"[(（]\s*@([A-Za-z0-9._]{2,30})\s*[)）]")
_RE_PROFILE = re.compile(r"instagram\.com/([A-Za-z0-9._]{2,30})/(?![a-z]{1,4}/)[?\"']", re.I)
# handle ではないパス
_NOT_HANDLE = frozenset({"p", "reel", "tv", "explore", "accounts", "about", "developer",
                         "legal", "directory", "stories", "reels", "embed"})


def handles_from_html(raw: bytes) -> dict[str, str]:
    """HTML から {post_id: 投稿者 handle} を採る。

    #1815 【設計】柱2（インフルエンサー）の handle 在庫が business_discovery の枠を
    空けている。グルメ媒体が «埋め込むに値する» と判断したアカウントは飲食である確度が
    高いので、埋め込みを読むときに handle も一緒に採る。**HTTP は増えない**（同じ HTML）。
    """
    text = decode_html(raw)
    out: dict[str, str] = {}
    for bq in RE_BLOCKQUOTE.findall(text):
        m = RE_PERMALINK.search(bq)
        if not m:
            continue
        handle = ""
        # permalink 自体が instagram.com/<handle>/p/<code> 形式ならそこが最も確実
        owner = re.search(r"instagram\.com/([A-Za-z0-9._]{2,30})/(?:p|reel|tv)/", bq, re.I)
        if owner and owner.group(1).lower() not in _NOT_HANDLE:
            handle = owner.group(1)
        if not handle:
            at = _RE_AT.search(strip_tags(bq))
            if at:
                handle = at.group(1)
        if not handle:
            prof = _RE_PROFILE.search(bq)
            if prof and prof.group(1).lower() not in _NOT_HANDLE:
                handle = prof.group(1)
        handle = handle.strip(".").lower()
        if handle and handle not in _NOT_HANDLE:
            out[m.group(1)] = handle
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
