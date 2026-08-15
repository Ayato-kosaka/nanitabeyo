#!/usr/bin/env python3
"""日本の店名どうしが同じ店を指しているかを測る。

既存の `jp_text.name_similarity` は文字bigramのJaccardと部分文字列包含だけで、
実データの食い違い方に合っていなかった。評価セット（正例4,381・負例60,000）で
測ると、しきい値0.78で再現率62%しか出ない。落ちていたのは次のような組である。

    カメチク 近江八幡店     ⇔ カメチク            支店名の有無
    焼そば 長谷川          ⇔ 焼きそば長谷川        送り仮名と空白
    サイゼリヤ 大阪大日…    ⇔ サイゼリア 大阪大日…   カナの揺れ
    手羽先唐揚げ 手羽丸（テバマル） ⇔ 手羽先唐揚げ 手羽丸  括弧の読み
    とんかつＫＹＫ京都ポルタ店 ⇔ KYK 京都ポルタ店     全角英字と語順

どれも同じ店なので、これらを拾えるように正規化と比較を組み直す。緩めた分の
誤結合は `name_match_eval.py` の負例（100m以内にある place_id の異なる既存DB行
どうし）で測る。負例は密集地から作られるので、実運用で間違えやすい組が集まる。
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from functools import lru_cache

# 括弧の中身は読み仮名や注記であることが多い。比較からは外す。
BRACKETS = re.compile(r"[（(\[【〔｛{][^）)\]】〕｝}]*[）)\]】〕｝}]")
# 支店を表す語尾。核となる店名を取り出すために落とす。
BRANCH_TAIL = re.compile(
    r"(本店|支店|分店|別館|新館|本館|駅前店|駅店|営業所|工場|店舗|店)$"
)
# 業態や修飾の語。店名の核ではないので、核の比較では落とす。
GENERIC_WORDS = (
    "レストラン", "ダイニング", "ラーメン", "らーめん", "そば処", "そば", "うどん",
    "居酒屋", "食堂", "カフェ", "喫茶", "珈琲", "焼肉", "焼鳥", "焼き鳥", "寿司", "鮨",
    "すし", "とんかつ", "カレー", "パスタ", "ピザ", "バル", "バー", "ホルモン",
    "定食", "中華", "洋食", "和食", "麺屋", "麺処", "酒場", "料理", "専門店",
)
SEPARATORS = re.compile(r"[\s　・･/／\-－ー~〜|｜,，、。.]+")
NOISE = re.compile(r"[^0-9a-z぀-ヿ一-鿿]+")

# カナの揺れを潰すための対応表。長音・小書き・濁点の有無で表記が割れる。
KANA_FOLD = str.maketrans({
    "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
    "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ",
    "ヴ": "ブ", "ヲ": "オ",
})


@lru_cache(maxsize=100_000)
def normalize(value: str, *, drop_brackets: bool = True) -> str:
    """比較用の基本形。全角半角・大小文字・区切りを潰す。

    括弧の中身は読み仮名や注記のことが多いので既定では落とすが、落とすと
    かえって一致しなくなる組がある。`FURUBO（フルボ）` と `フルボ` は、
    括弧の中こそが相手と一致する側である。呼び出し側で両方を試す。
    """

    text = unicodedata.normalize("NFKC", value or "").lower().translate(OLD_KANJI)
    if drop_brackets:
        text = BRACKETS.sub("", text)
    text = SEPARATORS.sub("", text)
    text = NOISE.sub("", text)
    return text


@lru_cache(maxsize=100_000)
def tokens(value: str) -> frozenset[str]:
    """区切りで分けた語の集合。語順の入れ替えと語の増減に効く。

    `味堂ほるもん焼` と `ほるもん焼 味堂`、`だし茶漬け えん …` と
    `だし茶漬け＋肉うどん えん …` は、並びで見ると一致しないが語で見ると重なる。
    """

    text = unicodedata.normalize("NFKC", value or "").lower()
    text = BRACKETS.sub(" ", text)
    parts = SEPARATORS.split(text)
    result = set()
    for part in parts:
        cleaned = _fold_kana(NOISE.sub("", part))
        if len(cleaned) >= 2:
            result.add(cleaned)
    return frozenset(result)


def _fold_kana(text: str) -> str:
    folded = []
    for character in text:
        if "ぁ" <= character <= "ゖ":
            character = chr(ord(character) + 0x60)
        folded.append(character)
    return "".join(folded).translate(KANA_FOLD).replace("ー", "")


@lru_cache(maxsize=100_000)
def kana_folded(value: str, *, drop_brackets: bool = True) -> str:
    """ひらがなをカタカナへ寄せ、長音と小書きの揺れを潰す。

    「焼そば」と「焼きそば」、「サイゼリヤ」と「サイゼリア」のような差は、
    ここまで潰して初めて一致する。
    """

    # 長音記号は NFKC 後も残る。カナの揺れの主因なので _fold_kana で落とす。
    return _fold_kana(normalize(value, drop_brackets=drop_brackets))


@lru_cache(maxsize=100_000)
def core(value: str) -> str:
    """支店名と業態語を落とした「核」。

    「カメチク 近江八幡店」と「カメチク」を同じにするための形である。
    ただし核が空になるところまでは削らない（「ラーメン山田」の「山田」は残す）。
    """

    text = kana_folded(value)
    previous = None
    while previous != text:
        previous = text
        stripped = BRANCH_TAIL.sub("", text)
        if stripped:
            text = stripped
    for word in (kana_folded(w) for w in GENERIC_WORDS):
        if word and word in text and len(text) > len(word):
            text = text.replace(word, "")
    return text or kana_folded(value)


def _bigrams(value: str) -> set[str]:
    if len(value) < 2:
        return {value} if value else set()
    return {value[index : index + 2] for index in range(len(value) - 1)}


def _jaccard(left: str, right: str) -> float:
    a, b = _bigrams(left), _bigrams(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _sequence_ratio(left: str, right: str) -> float:
    """送り仮名やカナ1字の揺れだけを救う比較。

    これは「ほぼ同じ綴り」を拾うためのものであって、似ている名前を拾うための
    ものではない。長い名前どうしは無関係でも並びが部分的に揃うため、素の
    SequenceMatcher を最大値に混ぜると誤結合が跳ね上がった
    （評価セットで誤結合率 0.15% -> 2.9%）。次の2つで用途を絞る。

    - 長さの差が2文字以内。支店名の有無のような大きな差は _containment の担当。
    - 比が 0.85 以上。それ未満は「似ているだけ」なので採らない。

    短い名前は1文字の差が効きすぎるので4文字未満には使わない
    （「福や」と「福屋」を同じ店にしてしまう）。
    """

    if len(left) < 4 or len(right) < 4:
        return 0.0
    if abs(len(left) - len(right)) > 2:
        return 0.0
    ratio = difflib.SequenceMatcher(None, left, right).ratio()
    return ratio if ratio >= 0.85 else 0.0


def _containment(left: str, right: str) -> float:
    """片方がもう片方を含むときの一致度。

    支店名の有無は「短い方が長い方に丸ごと入る」形で現れる。長さの比で減点すると
    「カメチク」⇔「カメチク近江八幡店」が 0.5 まで落ちてしまうので、含まれている
    こと自体を強く評価し、短すぎる語だけ減点する。1〜2文字の語は偶然入りうる。
    """

    if not left or not right:
        return 0.0
    short, long = (left, right) if len(left) <= len(right) else (right, left)
    if short not in long:
        return 0.0
    if len(short) <= 2:
        # 「紅龍」「青菜」「そら」のような2文字の屋号は、`中華料理 紅龍 飯田橋` や
        # `すし処そら` のように修飾を付けた表記と並ぶ。無関係な名前にも2文字は
        # 入りうるので下げたくなるが、掃引すると 0.6 でも 0.9 でも誤結合率は
        # ほぼ変わらず（0.00135 -> 0.00137）、再現率だけが 0.9365 -> 0.9448 に
        # 上がった。落とす理由がないので同じ店の証拠として扱う。
        return 0.9
    return 0.95


def similarity(left: str, right: str) -> float:
    """0.0〜1.0。1.0 は正規化後に完全一致。

    いくつかの見方の最大値を採る。どれか1つでも「同じ店だ」と言えれば同じ店、
    という立場である。誤結合率は評価セットで測って許容範囲に収めている。
    """

    if not left or not right:
        return 0.0
    if left == right:
        return 1.0

    for drop_left in (True, False):
        for drop_right in (True, False):
            a = kana_folded(left, drop_brackets=drop_left)
            b = kana_folded(right, drop_brackets=drop_right)
            if a and a == b:
                return 1.0

    kana_left, kana_right = kana_folded(left), kana_folded(right)
    if not kana_left or not kana_right:
        return 0.0

    scores = [
        _jaccard(kana_left, kana_right),
        _containment(kana_left, kana_right),
        # 1〜2文字の差（送り仮名の有無、カナ1字の揺れ）は bigram では大きく減点される。
        # 「焼そば長谷川」と「焼きそば長谷川」、「サイゼリヤ」と「サイゼリア」がこれ。
        # 並びを見る比較を足して拾う。別の店にも効いてしまう分は評価セットで測る。
        _sequence_ratio(kana_left, kana_right),
    ]

    # 括弧の中だけが相手と一致する組（`FURUBO（フルボ）` ⇔ `フルボ`）を拾う。
    for drop_left in (True, False):
        for drop_right in (True, False):
            if drop_left and drop_right:
                continue
            a = kana_folded(left, drop_brackets=drop_left)
            b = kana_folded(right, drop_brackets=drop_right)
            if a and b:
                scores.append(_containment(a, b))

    token_left, token_right = tokens(left), tokens(right)
    if token_left and token_right:
        shared = token_left & token_right
        smaller = min(len(token_left), len(token_right))
        if shared and len(shared) == smaller:
            # 短い方の語が全部そろっている。語順の入れ替えと語の増減はここで拾う。
            scores.append(0.9)
        elif shared:
            scores.append(0.85 * len(shared) / max(len(token_left), len(token_right)))

    core_left, core_right = core(left), core(right)
    if core_left and core_right:
        if core_left == core_right:
            # 核が一致するのは「支店名だけが違う」形。同じ屋号だが別店舗のことも
            # あるので 1.0 にはしない。座標と併せて使う前提の値である。
            scores.append(0.9)
        else:
            # 核どうしの包含だけを見る。核の bigram 一致まで採ると、業態語を
            # 落とした残りが偶然似ている別の店を拾ってしまう。
            scores.append(_containment(core_left, core_right) * 0.95)

    return max(scores)


# 旧字体と異体字。店名は看板の表記をそのまま入れるので、同じ店でも
# `長壽庵` と `長寿庵`、`そば處` と `そば処` のように割れる。
OLD_KANJI = str.maketrans({
    "壽": "寿", "處": "処", "與": "与", "萬": "万", "澤": "沢", "齋": "斎", "齊": "斉",
    "邊": "辺", "邉": "辺", "櫻": "桜", "淺": "浅", "藏": "蔵", "驛": "駅", "廣": "広",
    "國": "国", "圓": "円", "會": "会", "學": "学", "體": "体", "醫": "医", "區": "区",
    "濱": "浜", "嶋": "島", "槇": "牧", "瀨": "瀬", "籠": "篭", "菴": "庵", "龍": "竜",
    "藝": "芸", "禮": "礼", "德": "徳", "髙": "高", "﨑": "崎", "曻": "昇",
})

# カタカナ -> ローマ字。外来語の店名は `ソルティシュガー` と `Salty Sugar` のように
# 両方の表記で流通する。読みを介さないと同じ店だと分からない。
KANA_ROMAJI = {
    "キャ": "kya", "キュ": "kyu", "キョ": "kyo", "シャ": "sha", "シュ": "shu", "ショ": "sho",
    "チャ": "cha", "チュ": "chu", "チョ": "cho", "ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
    "ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo", "ミャ": "mya", "ミュ": "myu", "ミョ": "myo",
    "リャ": "rya", "リュ": "ryu", "リョ": "ryo", "ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo",
    "ジャ": "ja", "ジュ": "ju", "ジョ": "jo", "ビャ": "bya", "ビュ": "byu", "ビョ": "byo",
    "ピャ": "pya", "ピュ": "pyu", "ピョ": "pyo", "ファ": "fa", "フィ": "fi", "フェ": "fe",
    "フォ": "fo", "ヴァ": "va", "ヴィ": "vi", "ヴェ": "ve", "ヴォ": "vo", "ティ": "ti",
    "ディ": "di", "デュ": "du", "ウィ": "wi", "ウェ": "we", "ウォ": "wo", "ツァ": "tsa",
    "ツィ": "tsi", "ツェ": "tse", "ツォ": "tso", "シェ": "she", "ジェ": "je", "チェ": "che",
    "ア": "a", "イ": "i", "ウ": "u", "エ": "e", "オ": "o",
    "カ": "ka", "キ": "ki", "ク": "ku", "ケ": "ke", "コ": "ko",
    "サ": "sa", "シ": "shi", "ス": "su", "セ": "se", "ソ": "so",
    "タ": "ta", "チ": "chi", "ツ": "tsu", "テ": "te", "ト": "to",
    "ナ": "na", "ニ": "ni", "ヌ": "nu", "ネ": "ne", "ノ": "no",
    "ハ": "ha", "ヒ": "hi", "フ": "fu", "ヘ": "he", "ホ": "ho",
    "マ": "ma", "ミ": "mi", "ム": "mu", "メ": "me", "モ": "mo",
    "ヤ": "ya", "ユ": "yu", "ヨ": "yo",
    "ラ": "ra", "リ": "ri", "ル": "ru", "レ": "re", "ロ": "ro",
    "ワ": "wa", "ヲ": "o", "ン": "n",
    "ガ": "ga", "ギ": "gi", "グ": "gu", "ゲ": "ge", "ゴ": "go",
    "ザ": "za", "ジ": "ji", "ズ": "zu", "ゼ": "ze", "ゾ": "zo",
    "ダ": "da", "ヂ": "ji", "ヅ": "zu", "デ": "de", "ド": "do",
    "バ": "ba", "ビ": "bi", "ブ": "bu", "ベ": "be", "ボ": "bo",
    "パ": "pa", "ピ": "pi", "プ": "pu", "ペ": "pe", "ポ": "po",
    "ヴ": "vu", "ッ": "", "ー": "",
}
LATIN = re.compile(r"[a-z]")
KATAKANA = re.compile(r"[ァ-ヴ]")


def romanize(value: str) -> str:
    """カタカナをローマ字へ。カタカナ以外はそのまま残す。"""

    text = kana_folded(value)
    out, index = [], 0
    while index < len(text):
        pair = text[index : index + 2]
        if pair in KANA_ROMAJI:
            out.append(KANA_ROMAJI[pair]); index += 2; continue
        out.append(KANA_ROMAJI.get(text[index], text[index]))
        index += 1
    return "".join(out)


def _skeleton(value: str) -> str:
    """ローマ字表記の揺れを潰した骨格。

    日本語を経由した外来語は母音が増減し、l と r、b と v が入れ替わる。
    `Salty Sugar` は `ソルティシュガー`（sorutishuga）になる。母音を落として
    l/r と b/v を寄せると、両者は同じ骨格になる。
    """

    text = "".join(character for character in value if character.isascii() and character.isalpha())
    text = text.replace("l", "r").replace("v", "b")
    for double in ("sh", "ch", "ts"):
        text = text.replace(double, double[0])
    return "".join(character for character in text if character not in "aiueoyhn")


def latin_kana_similarity(left: str, right: str) -> float:
    """片方がローマ字、片方がカタカナのときだけ効く比較。**採用していない。**

    `ソルティシュガー` ⇔ `Salty Sugar` のような組を拾う狙いで作ったが、評価セットで
    測ると割に合わなかった。骨格（母音を落とし l/r と b/v を寄せた形）は情報を
    落としすぎていて、無関係な短い名前どうしが当たる。

        骨格の最小長 3: 正例 +11 / 誤り +38
        骨格の最小長 5: 正例  +7 / 誤り +16
        骨格の最小長 6: 正例  +6 / 誤り  +7
        骨格の最小長 8: 正例  +3 / 誤り  +2

    どの設定でも利得が誤りを上回らない。`similarity` からは呼んでいない。
    ローマ字の組を拾うには、読みを推測するのではなく Google 側に問い合わせて
    「その名前でその place_id が返るか」を見るほうが確実である（矩形 + Text Search）。

    残してあるのは、同じ案を再検討するときに測り直せるようにするためである。
    """

    folded = (kana_folded(left), kana_folded(right))
    latin_side = [bool(LATIN.search(text)) for text in folded]
    kana_side = [bool(KATAKANA.search(text)) for text in folded]
    if not ((latin_side[0] and kana_side[1]) or (kana_side[0] and latin_side[1])):
        return 0.0
    skeletons = [_skeleton(romanize(text)) for text in folded]
    if not all(len(skeleton) >= 3 for skeleton in skeletons):
        return 0.0
    ratio = difflib.SequenceMatcher(None, *skeletons).ratio()
    # 骨格は情報を落としているので、高く一致したときだけ採る。
    return ratio * 0.95 if ratio >= 0.8 else 0.0


def search_variant(value: str) -> str:
    """検索に投げ直すための「読める短縮形」。

    ``core`` は比較用の鍵なのでカナに畳んでしまい、検索クエリには使えない。
    こちらは表記を保ったまま、Google 側の表記と食い違いやすい部分だけを落とす。

    - 括弧の中（読み仮名・注記）を落とす
    - 末尾の支店語（〜店 など）を1語ぶん落とす
    - 全角スペースを半角に均す

    元の店名で ±250m の矩形が空になった行にだけ使う。矩形と A/B の裏取りは
    元のまま効くので、当たる範囲が広がるだけで判定の強さは変わらない。
    """

    text = unicodedata.normalize("NFKC", value or "").strip()
    text = BRACKETS.sub("", text).strip()
    tail = BRANCH_TAIL.search(text)
    if tail and tail.start() > 0:
        head = text[: tail.start()].rstrip("　 ・-")
        # 「〜店」を落とす前に、直前の地名らしき1語も一緒に落とす。
        # 「神戸屋レストラン 浜田山店」→「神戸屋レストラン」
        parts = SEPARATORS.split(head)
        if len(parts) > 1 and parts[-1]:
            head = " ".join(parts[:-1])
        if head:
            text = head
    return re.sub(r"\s+", " ", text).strip()
