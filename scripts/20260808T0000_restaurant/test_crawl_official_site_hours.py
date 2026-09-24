"""#1666 クローラの **ネットワークにも DB にも触らない部品**を固定する。

クロールそのものは回さない。固定するのは «事故になる箇所» だけである。

1. `public` へ書かないこと
2. `--limit` を必須にしてあること（既定値があると 28 万サイトへ出て行く）
3. 書き込みが **upsert ではなく delete → insert** であること
4. 入れる行が DB の CHECK 制約を満たすこと
5. 取りに行く作法を 6_2 と **共有していること**（写経していないこと）

実行:
    python3 -m unittest scripts/20260808T0000_restaurant/test_crawl_official_site_hours.py -v
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
import unittest
from unittest import mock
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("crawl_official_site_hours", HERE / "6_3_crawl_official_site_hours.py")
assert _spec and _spec.loader
crawler = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crawler)

import official_site_crawl as shared  # noqa: E402
from jp_site_opening_hours import parse_jp_site_opening_hours  # noqa: E402
import jp_site_opening_hours as jp_site  # noqa: E402


class SafetyTest(unittest.TestCase):
    def test_public_schema_is_refused(self) -> None:
        """⚠️ 本番へ書き込む判断はオーナーのもの。引数で選べないことを固定する。"""
        argv = sys.argv
        sys.argv = ["prog", "--schema", "public", "--limit", "1"]
        try:
            self.assertEqual(crawler.main(), 2)
        finally:
            sys.argv = argv

    def test_limit_is_required(self) -> None:
        """⚠️ **既定値を置いてはいけない。** 置くと、うっかり 28 万サイトへ出て行く。"""
        argv = sys.argv
        sys.argv = ["prog", "--schema", "dev"]
        try:
            with self.assertRaises(SystemExit):
                crawler.parse_args()
        finally:
            sys.argv = argv

    def test_min_interval_defaults_to_at_least_one_second(self) -> None:
        """相手のサーバへ連続で叩きに行かないこと。"""
        argv = sys.argv
        sys.argv = ["prog", "--schema", "dev", "--limit", "1"]
        try:
            self.assertGreaterEqual(crawler.parse_args().min_interval, 1.0)
        finally:
            sys.argv = argv


class ConnectSignatureTest(unittest.TestCase):
    """⚠️ **実際に落ちた**（run 33999525073）。

        TypeError: connect_postgres() missing 1 required keyword-only argument: 'allow_public'

    `pg_sync_common` は psycopg2 を要求するので **CI では import できない**。つまり
    DB へ繋ぐ行の «呼び方» は型検査でもユニットテストでも捕まらず、**実際に走らせて
    初めて落ちる**。外部サイトへ出る直前で落ちたので実害は無かったが、
    20 分のクロールの途中で落ちていたら相手のサイトを叩いた分が無駄になっていた。

    完全には防げないので、**せめてこの 1 行の形をソースとして固定する**。
    ⚠️ これは «呼び方が変わっていないか» しか見ない。CI で DB 層を import できない
    という限界は残っている（そう報告すること。«テストで守られている» と言わない）。
    """

    def test_connect_postgres_is_called_with_allow_public(self) -> None:
        source = (HERE / "6_3_crawl_official_site_hours.py").read_text()
        self.assertIn("connect_postgres(args.schema, allow_public=", source)

    def test_public_is_never_allowed_from_this_script(self) -> None:
        """このスクリプトは public を上で弾くので、常に False であること。"""
        source = (HERE / "6_3_crawl_official_site_hours.py").read_text()
        self.assertIn("allow_public=False", source)
        self.assertNotIn("allow_public=True", source)


class WriteShapeTest(unittest.TestCase):
    """書き込みの形。**ここが狂うと «休みの日に開いている» と表示される。**"""

    def test_write_is_delete_then_insert_not_upsert(self) -> None:
        """⚠️ **upsert にしてはいけない。**

        店が営業時間を減らしたとき（週 7 日 → 週 5 日）、upsert だと消えたはずの
        2 日が残り続け、**閉まっている日に «開いている» と表示する**。
        """
        self.assertIn("DELETE FROM", crawler.DELETE_SQL)
        self.assertIn("INSERT INTO", crawler.INSERT_SQL)

    def test_only_official_site_rows_are_touched(self) -> None:
        """⚠️ OSM / user / owner の行を巻き添えにしないこと。"""
        self.assertIn("WHERE source = %s", crawler.DELETE_SQL)
        self.assertEqual(crawler.SOURCE, "official_site")

    def test_source_is_one_of_the_values_the_check_constraint_allows(self) -> None:
        """migration の CHECK (source IN ('osm','official_site','user','owner'))。"""
        self.assertIn(crawler.SOURCE, {"osm", "official_site", "user", "owner"})

    def test_parsed_rows_satisfy_the_crosses_midnight_check(self) -> None:
        """⚠️ DB の CHECK は `crosses_midnight = (closes_at <= opens_at)` である。

        パーサの出力がこれを破ると **INSERT が落ちて取り込みが止まる**。
        深夜営業と 24 時超え表記の両方を見る。
        """
        for text in [
            "営業時間 11:30～14:30 18:00～21:00 定休日 月曜",
            "営業時間 18:00-02:00",
            "営業時間 20:00-25:00",
            "営業時間 11:00-14:00",
        ]:
            rows = parse_jp_site_opening_hours(text)
            self.assertIsNotNone(rows, text)
            assert rows is not None
            for row in rows:
                with self.subTest(text=text, row=row):
                    self.assertEqual(row.crosses_midnight, row.closes_at <= row.opens_at)

    def test_day_of_week_is_in_range(self) -> None:
        """CHECK (day_of_week BETWEEN 0 AND 6)。"""
        rows = parse_jp_site_opening_hours("営業時間 11:00-14:00")
        assert rows is not None
        for row in rows:
            self.assertIn(row.day_of_week, range(7))


class OneHopTest(unittest.TestCase):
    """#1666 «トップで読めなければ 1 ホップ辿る» の配線を縛る。

    効果は実測済み（近い順 120 件で parsed 24.2% → 33.3% /
    [run 35997159216](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/35997159216)）。ここで見るのは **配線**である。
    """

    def test_crawler_uses_the_shared_pick_hop(self) -> None:
        """⚠️ 測る側（6_4）と入れる側（6_3）が同じ選び方を使うこと。

        片方へ写経すると «測った数字» と «入れた行» が別のものを指し始める。
        """
        self.assertIs(crawler.pick_hop, shared.pick_hop)

    def test_hop_is_on_by_default_and_can_be_turned_off(self) -> None:
        with mock.patch.object(sys, "argv", ["6_3", "--limit", "1"]):
            self.assertTrue(crawler.parse_args().hop)
        with mock.patch.object(sys, "argv", ["6_3", "--limit", "1", "--no-hop"]):
            self.assertFalse(crawler.parse_args().hop)

    def test_hop_only_runs_when_the_top_page_failed(self) -> None:
        """⚠️ トップで読めたら辿らない（無駄な 1 リクエストを相手へ投げない）。"""
        source = inspect.getsource(crawler.main)
        self.assertIn('if args.hop and bucket != "parsed":', source)

    def test_hop_respects_robots_and_the_interval(self) -> None:
        """⚠️ 辿る先にも robots とレート制御を効かせる。"""
        source = inspect.getsource(crawler.main)
        hop_block = source[source.index('if args.hop and bucket != "parsed":') :]
        self.assertIn("robots_allows(hop_url", hop_block)
        self.assertIn("args.min_interval", hop_block)

    def test_source_url_becomes_the_hopped_page(self) -> None:
        """⚠️ 辿った先で読めたら出所 URL もそちらにする。

        トップの URL のまま入れると «どのページから採ったか» が後から分からなくなる。
        """
        source = inspect.getsource(crawler.main)
        hop_block = source[source.index('if args.hop and bucket != "parsed":') :]
        self.assertIn("url = hop_url", hop_block)

    def test_hop_adds_at_most_one_request(self) -> None:
        """⚠️ 1 店につき追加 1 リクエストまで。ループにしない。"""
        source = inspect.getsource(crawler.main)
        hop_block = source[
            source.index('if args.hop and bucket != "parsed":') : source.index("counts[bucket] += 1")
        ]
        self.assertEqual(hop_block.count("fetch("), 1, "辿る先の fetch が 1 回より多い")
        self.assertNotIn("while ", hop_block)
        self.assertNotIn("for ", hop_block)


class SharedWithMeasurementTest(unittest.TestCase):
    """⚠️ **6_2（測る）と 6_3（入れる）が同じ作法で叩くこと。**

    別々に書くと、«測った数字» と «入れた行» が別のものを指し始める。
    同じ関数オブジェクトを見ていることをここで縛る。
    """

    def test_crawler_uses_the_shared_fetch_and_classify(self) -> None:
        self.assertIs(crawler.fetch, shared.fetch)
        # #1666 6_3 も «理由つき» を使う。ページはもう取ってあるのに理由を捨てていた
        # （mentions_hours_unparsed が 209 件 = parsed の 162 件より多いのに、
        #  どこを直せば効くのか分からない状態だった）。
        self.assertIs(
            crawler.classify_page_with_reason, shared.classify_page_with_reason
        )
        self.assertIs(crawler.hours_excerpt, shared.hours_excerpt)
        self.assertIs(crawler.robots_allows, shared.robots_allows)
        self.assertIs(crawler.html_to_text, shared.html_to_text)

    def test_crawler_and_measurement_classify_with_the_same_function(self) -> None:
        """⚠️ 6_2（測る）と 6_3（入れる）が **同じ関数オブジェクト**を見ていること。

        別々のものを使い始めると «測った数字» と «入れた行» が別のものを指す。
        """
        measure = self._load_measurement()
        self.assertIs(
            crawler.classify_page_with_reason, measure.classify_page_with_reason
        )

    @staticmethod
    def _load_measurement():
        spec = importlib.util.spec_from_file_location(
            "measure_official_site_hours", HERE / "6_2_measure_official_site_hours.py"
        )
        assert spec and spec.loader
        measure = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(measure)
        return measure

    def test_measurement_uses_the_same_shared_module(self) -> None:
        measure = self._load_measurement()
        self.assertIs(measure.fetch, shared.fetch)
        # 6_2 は «諦めた理由» も数えるので理由つきの方を使う。どちらでも
        # **箱の判定は同じ**でなければならない（下の 2 本で縛る）。
        self.assertIs(measure.classify_page_with_reason, shared.classify_page_with_reason)


class ClassifyReasonTest(unittest.TestCase):
    """#1666 理由を足したせいで «箱» が動いていないことを縛る。

    ⚠️ 判定が動くと、直す前（parsed 12% / unparsed 23.9%）と直した後を
       **比べられなくなる**。理由は数えるためだけに足したものであって、
       «読める / 読めない» の境界を変えるものではない。
    """

    # ⚠️ **期待する箱を明示で書く。** «classify_page と classify_page_with_reason が
    #    一致するか» を見てはいけない（前者は後者へ委譲しているので、どう壊しても
    #    必ず一致する = 何も縛れない）。実際にこの形で書いて、判定を壊しても
    #    緑のままになることを確かめた。縛るなら «この文はこの箱» を直接書く。
    EXPECTED = (
        ("営業時間 11:30〜14:30 定休日 月曜", "parsed", None),
        ("営業時間 11:30〜14:30 定休日 第2・第4水曜", "mentions_hours_unparsed", "nth_week"),
        ("営業時間 11:30〜14:30 不定休", "mentions_hours_unparsed", "unparseable_closure"),
        ("営業時間 午前11時〜午後2時", "mentions_hours_unparsed", "ampm"),
        ("営業時間 11:30〜14:30 定休日 年末年始", "mentions_hours_unparsed", "closed_days_unreadable"),
        ("当店の紹介です。11:30〜14:30 に何かします", "no_hours_mentioned", None),
        ("OPEN 11:00-14:00 Closed on Mondays", "not_japanese_page", None),
        ("", "not_japanese_page", None),
    )

    SAMPLES = tuple(text for text, _bucket, _reason in EXPECTED)

    def test_buckets_are_what_they_were_before_the_reason_was_added(self) -> None:
        for text, bucket, _reason in self.EXPECTED:
            self.assertEqual(
                shared.classify_page(text),
                bucket,
                f"箱が動いた。直す前の数字（parsed 12% / unparsed 23.9%）と"
                f"比べられなくなる: {text!r}",
            )

    def test_reasons_are_what_the_parser_actually_gives_up_on(self) -> None:
        for text, _bucket, reason in self.EXPECTED:
            self.assertEqual(shared.classify_page_with_reason(text)[1], reason, repr(text))

    def test_classify_page_stays_a_thin_delegate(self) -> None:
        """判定を 2 箇所に持たない（持つと片方だけ直ってずれる）。"""
        source = inspect.getsource(shared.classify_page)
        self.assertIn("classify_page_with_reason", source)

    def test_reason_is_only_attached_to_the_unparsed_bucket(self) -> None:
        for text in self.SAMPLES:
            bucket, reason = shared.classify_page_with_reason(text)
            if bucket == "mentions_hours_unparsed":
                self.assertIn(reason, jp_site.GIVE_UP_REASONS, f"未知の理由: {reason!r}")
            else:
                self.assertIsNone(reason, f"{bucket} に理由が付いている: {text!r}")

    def test_every_reason_name_is_declared(self) -> None:
        """パーサが返す理由は必ず GIVE_UP_REASONS に載っていること。"""
        for text in self.SAMPLES:
            _rows, reason = jp_site.parse_jp_site_opening_hours_with_reason(text)
            if reason is not None:
                self.assertIn(reason, jp_site.GIVE_UP_REASONS)

    def test_parse_without_reason_matches_parse_with_reason(self) -> None:
        """公開関数が薄いラッパのままであること（判定を 2 箇所に持たない）。"""
        for text in self.SAMPLES:
            rows, _reason = jp_site.parse_jp_site_opening_hours_with_reason(text)
            self.assertEqual(rows, jp_site.parse_jp_site_opening_hours(text))


class CandidateSqlTest(unittest.TestCase):
    def test_only_missing_avoids_hitting_the_same_site_twice(self) -> None:
        """⚠️ 再実行で同じサイトを二度叩かないこと。相手への迷惑を増やさない。"""
        self.assertIn("NOT EXISTS", crawler.ONLY_MISSING_CLAUSE)
        self.assertIn("restaurant_opening_hours", crawler.ONLY_MISSING_CLAUSE)

    def test_only_http_urls_are_crawled(self) -> None:
        self.assertIn("^https?://", crawler.CANDIDATE_SQL)

    def test_candidates_are_reproducible_by_seed(self) -> None:
        self.assertIn("md5(", crawler.ORDER_BY_SEED)
        self.assertIn("%(seed)s", crawler.ORDER_BY_SEED)

    def test_seed_order_is_the_default(self) -> None:
        """⚠️ 既定が seed であること。`inspect_opening_hours_reach.py` の rank
        ヒストグラムはこの並びを根拠にしているので、既定が黙って変わってはいけない。

        既定値は help 文字列ではなく、**実際に parse させて**確かめる。
        """
        with mock.patch.object(sys, "argv", ["6_3", "--limit", "1"]):
            args = crawler.parse_args()
        self.assertEqual(args.order, "seed")


class HoursExcerptTest(unittest.TestCase):
    """#1666 «諦めた箇所» の抜粋は **診断専用**で、判定にも長さにも影響しない。

    ⚠️ 出力先は public リポジトリの Actions ログである。他人のサイトの本文を
       «診断に要る最小限» を超えて転記しないことを、ここで長さとして縛る。
    """

    def test_excerpt_is_bounded(self) -> None:
        text = "あ" * 500 + "営業時間" + "い" * 500
        excerpt = shared.hours_excerpt(text)
        self.assertIsNotNone(excerpt)
        self.assertLessEqual(
            len(excerpt),
            shared.EXCERPT_WIDTH * 2 + len("営業時間"),
            "⚠️ 抜粋が長すぎる。他人のサイトの本文を必要以上に転記している",
        )

    def test_excerpt_contains_the_hours_mention(self) -> None:
        excerpt = shared.hours_excerpt("前置き。営業時間 11:30〜14:30 です。")
        self.assertIn("営業時間", excerpt)

    def test_no_mention_yields_none(self) -> None:
        self.assertIsNone(shared.hours_excerpt("この文には手がかりがありません。"))
        self.assertIsNone(shared.hours_excerpt(""))

    def test_excerpt_does_not_change_the_bucket(self) -> None:
        """抜粋を取っても分類は動かない（診断が判定へ漏れていないこと）。"""
        for text, bucket, _reason in ClassifyReasonTest.EXPECTED:
            before = shared.classify_page(text)
            shared.hours_excerpt(text)
            self.assertEqual(shared.classify_page(text), before)
            self.assertEqual(before, bucket)


if __name__ == "__main__":
    unittest.main()


class NearFilterTest(unittest.TestCase):
    """#1666 `--near` で 1 エリアだけを対象にできること。

    全国へ均等に撒くと «その地点でユーザーが見る画面» は動かない。実測
    （run 35967307893）で近い順 1,000 件のうち営業時間を持つ店は東京駅 17 /
    大阪駅 34 / 札幌駅 64 しかなく、全国へ 2,000 件撒いても 1 件も動かない。

    ⚠️ ここで縛るのは 2 つ。**黙って «全国» へ落ちないこと**（1 エリアのつもりで
    28 万サイトへ出て行く形）と、**並びを変えていないこと**（並びは
    `inspect_opening_hours_reach.py` が «前半が picked over か» を測る根拠）。
    """

    def test_near_is_off_by_default(self) -> None:
        self.assertEqual(crawler.parse_near(None), (None, None))
        self.assertEqual(crawler.parse_near(""), (None, None))
        self.assertEqual(crawler.parse_near("   "), (None, None))

    def test_near_is_parsed(self) -> None:
        self.assertEqual(crawler.parse_near("35.681,139.767"), (35.681, 139.767))
        # 空白は許す（コピペしやすさのため）
        self.assertEqual(crawler.parse_near(" 35.681 , 139.767 "), (35.681, 139.767))

    def test_broken_near_raises_instead_of_falling_back_to_nationwide(self) -> None:
        broken = (
            "35.681",             # 経度が無い
            "35.681,139.767,0",  # 余分な項
            "abc,139",           # 緯度が数値でない
            "35.681,abc",        # 経度が数値でない
            "91,139",            # 緯度が範囲外
            "35,181",            # 経度が範囲外（打ち間違いで起こりやすい形）
        )
        for value in broken:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    crawler.parse_near(value)

    def test_search_path_includes_extensions_for_postgis(self) -> None:
        """#1666 ⚠️ **PostGIS（`geography` / `ST_DWithin`）は `extensions` に居る。**

        `connect_postgres` が張る search_path は `<schema>, public` で `extensions` が
        無いため、`--near` の SQL が `type "geography" does not exist` で落ちた
        （run 35969811492）。テーブルは `{schema}.` で修飾していたので気づけず、
        **型と関数の解決だけが search_path に依存していた**。

        ここが消えると «絞ったつもりで落ちる» に戻るので、文字列として縛る。
        """
        source = inspect.getsource(crawler)
        self.assertIn("SET search_path TO {}, extensions, public", source)
        # ⚠️ 共有ヘルパ（connect_postgres）側を広げていないこと。あれは 9_1 ほか
        #    全部の同期が使うので、PostGIS が要るこのスクリプトへ閉じる。
        #    ⚠️ **`extensions` の語だけで探さない。** あのファイルは
        #       `from psycopg2.extensions import connection` を import している
        #       （最初そう書いて誤検知した）。search_path の行だけを見る。
        shared_source = (HERE / "pg_sync_common.py").read_text(encoding="utf-8")
        search_path_lines = [
            line for line in shared_source.splitlines() if "SET search_path" in line
        ]
        self.assertEqual(len(search_path_lines), 1, search_path_lines)
        self.assertNotIn("extensions", search_path_lines[0])

    def test_candidate_sql_has_a_near_placeholder_and_the_order_is_injected(self) -> None:
        sql = crawler.CANDIDATE_SQL
        self.assertIn("{near}", sql)
        # 並びは «呼ぶ側が渡すもの»。SQL へ既定を焼き込まない
        self.assertIn("{order}", sql)
        self.assertNotIn("ORDER BY", sql)

        fmt = dict(schema="dev", only_missing="", order=crawler.ORDER_BY_SEED)
        without = sql.format(near="", **fmt)
        with_near = sql.format(near=crawler.NEAR_CLAUSE, **fmt)
        self.assertNotIn("ST_DWithin", without)
        self.assertIn("ST_DWithin", with_near)
        # 半径も地点もパラメータで渡す（SQL へ焼き込まない）
        for name in ("%(near_lat)s", "%(near_lon)s", "%(near_radius_m)s"):
            self.assertIn(name, with_near)
        # 絞っても seed の並びは変わらない
        self.assertIn("ORDER BY md5(l.restaurant_id::text || %(seed)s)", with_near)

    def test_distance_order_sorts_by_the_near_point(self) -> None:
        """#1666 `--order distance` は `--near` の地点から近い順（KNN の `<->`）。"""
        order = crawler.ORDER_BY_DISTANCE
        self.assertIn("<->", order)
        self.assertIn("r.location", order)
        # 地点はパラメータで渡す（SQL へ焼き込まない）
        for name in ("%(near_lat)s", "%(near_lon)s"):
            self.assertIn(name, order)
        # ⚠️ PostGIS の型が要る。`::geography` を落とすと距離が «度» になり、
        #    緯度によって並びが歪む（東京では経度 1 度 ≒ 90km、緯度 1 度 ≒ 111km）。
        self.assertIn("::geography", order)

    def test_the_two_orders_are_different(self) -> None:
        self.assertNotEqual(crawler.ORDER_BY_SEED, crawler.ORDER_BY_DISTANCE)

    def test_distance_order_without_near_is_refused(self) -> None:
        """⚠️ 黙って seed 順へ落ちないこと。«近い順のつもりで全国を歩く» は気づけない。

        `main()` は DB へ繋いでしまうので、判定の条件を **ソースの文字列として**縛る。
        """
        source = inspect.getsource(crawler.main)
        self.assertIn('args.order == "distance" and near_lat is None', source)
        self.assertIn("raise ValueError", source)
