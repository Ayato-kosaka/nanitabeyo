#!/usr/bin/env python3
"""#1815 «取り込み条件を検査条件に流用する» 形を、経路のどこにも復活させない。

## 直した欠陥を «パターン» として 1 文で言うと

> **取り込むために使った述語で、取り込んだ結果を検査していた。**
> 同じ述語で選んだ行を同じ述語で当て直しても構造上いつでも真になるので、
> その検査は «通ること» しか言えない。

実害: 1_3 は «緯度20.0–46.5 / 経度122.0–154.0» の矩形で日本を取り込む。この矩形は
韓国全土とロシア沿海地方を含む。8_1 の海外チェックが同じ矩形を catalog へ当てていたため、
韓国の店 100,063 行（16.13%）が入った run でも `observed_value = 0.0` で PASS し続け
（restaurant_quality_results の実測）、126 店 / dish_media 1,025 行が dev へ配信された。

## 水平展開の判定（CLAUDE.md §5 の 3.「1 件ずつ当てはまる/当てはまらないを実データで判定」）

8_1 の全 check と 9_9_audit_*.py を 1 件ずつ当たり直した結果。

| 対象 | 判定 | 理由 |
| --- | --- | --- |
| `restaurant_overseas_only_from_existing_pg` | **当てはまる → 直した** | 取り込み矩形を catalog へ当てていた。共通判定（国 / 文字 / **国外**矩形）へ置換。実測 旧 0 行 → 新 100,063 行 |
| `sns_media_store_inside_japan` | **当てはまる → 直した** | 同上。配信カタログに対して同じ矩形を当てていた。実測 旧 0 行 → 新 931 行 |
| `restaurant_open_data_country_is_japan` | **当てはまる（残す）** | 1_3 が `country='JP'` で絞った結果に `country='JP'` を当てている。**国の検査にはならない**が «国の値が配管の途中で消えていないか» の検査としては成立するので残す。国の検査は上の 2 つが独立根拠で持つ |
| `restaurant_required_fields_valid` | 当てはまらない | 座標の範囲は ±90/±180 という**普遍的な**上限で、取り込みの述語ではない |
| `source_record_key_unique` / `seed_id_unique` / `accepted_google_place_id_unique` / `restaurant_google_place_id_unique` / `sns_media_pg_unique_key_unique` / `coverage_pair_unique` / `dish_media_id_unique` | 当てはまらない | 一意性は入力側の述語と無関係な性質 |
| `one_source_record_one_link` / `one_match_row_per_seed` / `existing_pg_restaurants_preserved` / `existing_pg_serving_values_preserved` / `restaurant_merge_no_data_loss` | 当てはまらない | **2 つの別々の成果物を突き合わせている**（入力の述語ではなく «前の工程の出力» が基準）。片方が壊れれば赤くなる |
| `coverage_cross_product_complete` | 当てはまらない | 期待値は «セル数 × カテゴリ数» で、coverage を作った述語ではない |
| `jp_gate_category_count` | 当てはまらない | 参照表（134 カテゴリ）の件数。パイプラインの出力ではない |
| `sns_media_required_fields_valid` | 当てはまらない | 根拠は **PostgreSQL の NOT NULL / CHECK**（外部の契約） |
| `sns_media_duplicate_post_rate` / `sns_media_store_known_rate` / `sns_media_jp_gate_category_rate` | 当てはまらない | 重複率・欠落率・カテゴリ外率。述語の流用ではない |
| `9_9_audit_country_code.py` | **当てはまる（注記して残す）** | «パイプライン製の行は取り込み時の国を運んだ値だから正しい» を前提にしている。**«全行埋められるか» の監査としては成立する**ので残し、docstring に «値が正しいかは 9_9_audit_foreign_rows.py が見る» と明記した |
| `9_9_inspect_missing_country.py` | 当てはまらない | 国が引けない行を 1 件ずつ**見る**ための一覧。合否判定を持たない |
| `9_9_audit_multi_place_posts.py` | 当てはまらない | «1 投稿が何店に紐づいたか» を数える。基準は投稿側の実データで、収集条件の流用ではない |
| `9_9_audit_google_derived_data.py` / `9_9_audit_image_fallback.py` | 当てはまらない | PostgreSQL の実データを数えるだけ。パイプラインの述語を持ち込んでいない |
| `9_9_audit_public_readiness.py` / `9_9_audit_sync_drift.py` / `9_9_verify_sync_result.py` | 当てはまらない | 同期の前後・2 スキーマ間の差を見る。基準は «別のもの» である |

## この test が固定すること

1. 取り込み矩形の値が、配信・検査のどの **式**にも現れないこと（コメントは可）
2. «日本の店ではない» の判定が `common_sns` の **1 箇所**にしかないこと
3. `FOREIGN_TERRITORY_BOXES` に **日本本土を含む矩形**を足せないこと
   （«日本を囲う矩形» を入れた瞬間に同じ事故が戻る）
4. 実データの golden set で、日本国内の韓国料理店を海外と判定しないこと
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import common_sns  # noqa: E402

# 1_3_load_overture.py が «日本» として取り込むのに使う矩形の値。
# この 4 つが検査・配信の式に現れたら、それは取り込み条件の流用である。
INGEST_BBOX_LITERALS = ("20.0", "46.5", "122.0", "154.0")

# 判定を持ってよい唯一のファイル。
JUDGEMENT_HOME = "common_sns.py"

# 判定を «使う» ファイル（式を埋め込むだけで、自分では書かない）。
JUDGEMENT_USERS = (
    "8_1_validate_catalogs.py",
    "9_1_build_sns_dish_media_catalog.py",
    "9_1_sync_restaurants.py",
    "9_2_sync_sns_dish_media.py",
    "9_9_audit_foreign_rows.py",
)

# 判定の «部品»。common_sns 以外がこれを書いていたら写経である。
JUDGEMENT_FRAGMENTS = (
    "가-힣",  # ハングル音節
    "Ѐ-ӿ",  # キリル
    "daero",  # 韓国式住所トークン
    "BETWEEN 34.0 AND 38.7",  # 韓国本土の矩形
)


def _strip_comments(text: str) -> str:
    """SQL の `--` 行コメントと Python の `#` 行コメントを落とす。

    事故の説明には当然その値（矩形の数字）が出てくる。**説明を消さずに残すため**、
    式に現れるかどうかだけを見る。
    """
    out = []
    for line in text.splitlines():
        line = line.split("--")[0]
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


def _source(name: str) -> str:
    return (_HERE / name).read_text(encoding="utf-8")


class IngestPredicateNotReusedTest(unittest.TestCase):
    def test_ingest_bounding_box_is_not_used_in_any_delivery_or_gate(self) -> None:
        """取り込みの矩形の値が、配信・検査の式に現れないこと。"""
        for name in JUDGEMENT_USERS:
            code = _strip_comments(_source(name))
            for literal in INGEST_BBOX_LITERALS:
                with self.subTest(file=name, literal=literal):
                    self.assertNotIn(
                        literal,
                        code,
                        f"{name} に取り込み矩形の値 {literal} が現れています。"
                        "取り込み条件で取り込み結果を検査すると構造上いつでも緑になります",
                    )

    def test_only_common_sns_spells_out_the_judgement(self) -> None:
        """判定の部品を書いてよいのは common_sns だけ（写経の禁止）。"""
        for name in JUDGEMENT_USERS:
            code = _source(name)
            for fragment in JUDGEMENT_FRAGMENTS:
                with self.subTest(file=name, fragment=fragment):
                    self.assertNotIn(
                        fragment,
                        code,
                        f"{name} が判定を自前で持っています。common_sns の "
                        "foreign_store_sql / foreign_restaurant_sql を呼んでください",
                    )

    def test_every_user_imports_the_shared_judgement(self) -> None:
        """判定を使う側は、必ず common_sns から取り込んでいること。"""
        for name in JUDGEMENT_USERS:
            code = _source(name)
            with self.subTest(file=name):
                self.assertTrue(
                    re.search(r"foreign_(store|restaurant)_sql", code),
                    f"{name} が共通判定を呼んでいません",
                )

    def test_judgement_home_defines_every_part(self) -> None:
        """判定の部品は common_sns にだけ «定義» があること。

        矩形は SQL 文字列ではなく定数（FOREIGN_TERRITORY_BOXES）で持つので、
        `BETWEEN 34.0 AND 38.7` は common_sns のソースには現れない（生成される）。
        名前で確かめる。
        """
        home = _source(JUDGEMENT_HOME)
        for name in ("FOREIGN_SCRIPT_RE", "KOREAN_ADDRESS_RE", "JAPAN_TEXT_RE",
                     "FOREIGN_TERRITORY_BOXES", "JAPAN_ENCLAVE_BOXES",
                     "foreign_restaurant_sql", "foreign_store_sql"):
            with self.subTest(part=name):
                self.assertIn(name, home)
                self.assertTrue(hasattr(common_sns, name))


class ForeignBoxesNeverCoverJapanTest(unittest.TestCase):
    """«国外を囲う矩形» に日本本土を含む矩形を足せないようにする。

    (c) の根拠が成立するのは «そこに居れば日本ではない» と単独で言える土地だけである。
    «日本を囲う矩形» を 1 つ足した瞬間に #1815 と同じ事故が戻るので、代表的な日本の街を
    固定して «どの矩形にも入らないこと» を試験する。
    """

    JAPAN_CITIES = {
        "東京(新大久保)": (35.700, 139.701),
        "大阪(鶴橋)": (34.665, 135.532),
        "福岡(中洲)": (33.590, 130.409),
        "札幌": (43.055, 141.352),
        "那覇": (26.212, 127.679),
        "対馬(厳原)": (34.203, 129.291),
        "佐世保": (33.170, 129.722),
        "壱岐": (33.756, 129.709),
        "隠岐": (36.204, 133.324),
        "稚内": (45.415, 141.673),
        "五島": (32.695, 128.841),
    }

    FOREIGN_CITIES = {
        "ソウル": (37.566, 126.978),
        "釜山": (35.180, 129.075),
        "済州": (33.499, 126.531),
        "鬱陵島": (37.484, 130.905),
        "ウラジオストク": (43.118, 131.891),
    }

    @staticmethod
    def _in_box(lat: float, lng: float, boxes) -> bool:
        return any(
            lo <= lat <= hi and wlo <= lng <= whi for lo, hi, wlo, whi, _ in boxes
        )

    def _judged_foreign_by_geometry(self, lat: float, lng: float) -> bool:
        return self._in_box(lat, lng, common_sns.FOREIGN_TERRITORY_BOXES) and not (
            self._in_box(lat, lng, common_sns.JAPAN_ENCLAVE_BOXES)
        )

    def test_no_japanese_city_falls_into_a_foreign_box(self) -> None:
        for label, (lat, lng) in self.JAPAN_CITIES.items():
            with self.subTest(city=label):
                self.assertFalse(
                    self._judged_foreign_by_geometry(lat, lng),
                    f"{label} が «国外領域» の矩形に入っています",
                )

    def test_foreign_cities_fall_into_a_foreign_box(self) -> None:
        for label, (lat, lng) in self.FOREIGN_CITIES.items():
            with self.subTest(city=label):
                self.assertTrue(
                    self._judged_foreign_by_geometry(lat, lng),
                    f"{label} が «国外領域» の矩形から漏れています",
                )

    def test_enclave_boxes_are_inside_a_foreign_box(self) -> None:
        """日本領の飛び地の除外は «国外矩形と重なっている» ときだけ意味がある。

        重なっていない矩形を除外に足すのは、判定を静かに弱めるだけである。
        """
        for lat_lo, lat_hi, lng_lo, lng_hi, label in common_sns.JAPAN_ENCLAVE_BOXES:
            center = ((lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2)
            with self.subTest(enclave=label):
                self.assertTrue(
                    self._in_box(*center, common_sns.FOREIGN_TERRITORY_BOXES),
                    f"{label} は国外矩形と重なっていないので除外する意味がありません",
                )


class JudgementGoldenSetTest(unittest.TestCase):
    """restaurant_catalog（run=restaurant-2026-08-23）から採った実データで固定する。

    左が «日本の店»、右が «日本以外の店»。**日本国内の韓国料理店を弾かないこと**が
    この判定の主目的なので、新大久保・鶴橋・中洲の実在店を golden set に入れる。
    """

    JAPAN_ROWS = (
        ("하남돼지집-ハナムデジジップ新大久保イケメン通り店", "東京都"),
        ("정낙지-ジョンナッチ/ナッコプセ/大阪/堀江/韓国料理", "西区北堀江1-13-21"),
        ("포장마차거리", "Nakasu, 1 Chome−8−8 仲柳ビル"),
        ("焼肉長介（야키니쿠 쵸스케）", "Yakuin, 2 Chome−1−8 リアン薬院ビル 7F"),
        ("보랏빛　ポラピッ　韓国かき氷　糸ピンス", "ASAHI2-CHOME17-17"),
        ("ＢＡＲ　ＢＯＯＴ　ＣＡМＰ", "熊本県八代市本町一丁目７－１２"),
        ("Lounge Я", "岩手県盛岡市菜園一丁目11番23号"),
        ("吉野家寒川一之宮店", "2-Сhōme-12-15 Ichinomiya"),
        ("Cafe Cheonghak-dong", "2 Chome-11-20 Ueno"),
        ("Cycling Cafe Chari-Gun", "Owatarimachi, 1 Chome−１５−1"),
        ("Hakuba Brewing Company", "〒399-9301 Nagano-ken, Kitaazumi-gun, Hakuba-mura"),
        ("Ruli-ro", "東京都世田谷区池尻３丁目１６−３"),
        ("炉端×おでん Lo-ro", "沖縄県名護市城1-9-5"),
        ("Cafe ri-ri", "1-1 Honmachi"),
        ("居酒屋　対馬屋", "長崎県対馬市厳原町大手橋1068番地"),
    )

    FOREIGN_ROWS = (
        ("돈까스하우스", "252-1 Yangsang-dong"),
        ("우리식당", "152 Ulleungsunhwan-ro, Ulleung-eup"),
        ("Cafe Place", "20 Yonsei-ro"),
        ("Coffee YETI", "Beodeunaru-ro 19-gil"),
        ("Mip", '"32, Songpa-dong"'),
        ("Культура Пивная", "улица Суханова 6"),
        ("싱싱 참 맛집", "Jocheon-eup, Hamdeok-ri, 3129번지 KR 1층"),
    )

    @staticmethod
    def _is_foreign(name: str, address: str) -> bool:
        """SQL と同じ規則を Python で当てる（正規表現は common_sns の 1 箇所から取る）。

        3 方言（BigQuery / PostgreSQL / Python）で同じ答えになる書き方に揃えてあるので、
        ここで Python として当てられることが «方言差で静かに壊れていない» ことの検算になる。
        座標の根拠 (c) は ForeignBoxesNeverCoverJapanTest が別に見る。
        """
        text = f"{name} {address}"
        if re.search(common_sns.KOREAN_ADDRESS_RE, address):
            return True
        return bool(
            re.search(common_sns.FOREIGN_SCRIPT_RE, text)
            and not re.search(common_sns.JAPAN_TEXT_RE, text)
        )

    def test_japanese_stores_are_not_rejected(self) -> None:
        for name, address in self.JAPAN_ROWS:
            with self.subTest(store=name):
                self.assertFalse(
                    self._is_foreign(name, address),
                    f"日本の店を海外と判定しました: {name!r} / {address!r}",
                )

    def test_foreign_stores_are_rejected(self) -> None:
        for name, address in self.FOREIGN_ROWS:
            with self.subTest(store=name):
                self.assertTrue(
                    self._is_foreign(name, address),
                    f"海外の店を見落としました: {name!r} / {address!r}",
                )


if __name__ == "__main__":
    unittest.main()
