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
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("crawl_official_site_hours", HERE / "6_3_crawl_official_site_hours.py")
assert _spec and _spec.loader
crawler = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crawler)

import official_site_crawl as shared  # noqa: E402
from jp_site_opening_hours import parse_jp_site_opening_hours  # noqa: E402


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


class SharedWithMeasurementTest(unittest.TestCase):
    """⚠️ **6_2（測る）と 6_3（入れる）が同じ作法で叩くこと。**

    別々に書くと、«測った数字» と «入れた行» が別のものを指し始める。
    同じ関数オブジェクトを見ていることをここで縛る。
    """

    def test_crawler_uses_the_shared_fetch_and_classify(self) -> None:
        self.assertIs(crawler.fetch, shared.fetch)
        self.assertIs(crawler.classify_page, shared.classify_page)
        self.assertIs(crawler.robots_allows, shared.robots_allows)
        self.assertIs(crawler.html_to_text, shared.html_to_text)

    def test_measurement_uses_the_same_shared_module(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "measure_official_site_hours", HERE / "6_2_measure_official_site_hours.py"
        )
        assert spec and spec.loader
        measure = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(measure)
        self.assertIs(measure.fetch, shared.fetch)
        self.assertIs(measure.classify_page, shared.classify_page)


class CandidateSqlTest(unittest.TestCase):
    def test_only_missing_avoids_hitting_the_same_site_twice(self) -> None:
        """⚠️ 再実行で同じサイトを二度叩かないこと。相手への迷惑を増やさない。"""
        self.assertIn("NOT EXISTS", crawler.ONLY_MISSING_CLAUSE)
        self.assertIn("restaurant_opening_hours", crawler.ONLY_MISSING_CLAUSE)

    def test_only_http_urls_are_crawled(self) -> None:
        self.assertIn("^https?://", crawler.CANDIDATE_SQL)

    def test_candidates_are_reproducible_by_seed(self) -> None:
        self.assertIn("md5(", crawler.CANDIDATE_SQL)
        self.assertIn("%(seed)s", crawler.CANDIDATE_SQL)


if __name__ == "__main__":
    unittest.main()
