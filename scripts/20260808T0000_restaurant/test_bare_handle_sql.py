"""#1273 4_17（素のハンドル → 店の確定）の «壊れると静かに間違う» ところを固定する。

BigQuery へは繋がない。検証するのは 2 つだけで、どちらも**壊れても実行は成功してしまう**もの:

1. `common_sns` の抽出規則（正規表現）が、意図したトークンだけを切り出すこと
   （BigQuery の RE2 と Python の re が同じ結果になる書き方しか使っていないことの確認も兼ねる）
2. 4_17 が組み立てる SQL の «契約»
   - 誤爆率を数えるための `cand_all`（stoplist 適用前）が残っていること
   - 後入れ UPDATE が **既に seed がある行を書き換えない**条件を持っていること
   - 裏取り済みだけを使う既定と、`--include-uncorroborated` の差が SQL に出ること
"""

from __future__ import annotations

import importlib.util
import re
import sys
import types
import unittest
from pathlib import Path

# pipeline_common は import 時に `from google.cloud import bigquery` する。ここは SQL 文字列
# だけを見るので、import を通すためだけの軽量スタブを差し込む（test_pillar1 と同じ理由）。
if "google.cloud.bigquery" not in sys.modules:
    _bq = types.ModuleType("google.cloud.bigquery")
    for _n in ("Client", "ScalarQueryParameter", "ArrayQueryParameter", "QueryJobConfig",
               "LoadJobConfig", "ParquetOptions"):
        setattr(_bq, _n, type(_n, (), {}))
    _bq.WriteDisposition = types.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")
    _bq.SourceFormat = types.SimpleNamespace(NEWLINE_DELIMITED_JSON="NDJSON", PARQUET="PARQUET")
    _google = sys.modules.setdefault("google", types.ModuleType("google"))
    _cloud = sys.modules.setdefault("google.cloud", types.ModuleType("google.cloud"))
    setattr(_google, "cloud", _cloud)
    setattr(_cloud, "bigquery", _bq)
    sys.modules["google.cloud.bigquery"] = _bq

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


mod_4_17 = _load(HERE / "4_17_resolve_bare_handles.py", "resolve_bare_handles")


class FakePipeline:
    """`table()` だけを持つ最小のスタブ（SQL 文字列の検証にはこれで足りる）。"""

    def table(self, name: str) -> str:
        return f"proj.ds.{name}"


class ExtractRuleTest(unittest.TestCase):
    """`common_sns` の正規表現が «何を採り、何を採らないか»。"""

    def _tokens(self, text: str) -> list[str]:
        cleaned = re.sub(common_sns.BARE_HANDLE_HASHTAG_RE, " ",
                         re.sub(common_sns.BARE_HANDLE_URL_RE, " ", text.lower()))
        out = []
        for token in re.findall(common_sns.BARE_HANDLE_TOKEN_RE, cleaned):
            handle = re.sub(common_sns.BARE_HANDLE_TRIM_TRAIL_RE, "",
                            re.sub(common_sns.BARE_HANDLE_TRIM_LEAD_RE, "", token))
            if (re.match(common_sns.BARE_HANDLE_SHAPE_RE, handle)
                    and re.search(common_sns.BARE_HANDLE_HAS_LETTER_RE, handle)):
                out.append(handle)
        return out

    def test_bare_handle_in_japanese_caption(self) -> None:
        # 埋め込み由来のキャプション（改行が空白へ潰れ、@ が剥がれている）
        self.assertIn("cafe_fune", self._tokens("📍 珈琲 cafe_fune 本日オープン"))

    def test_at_mention_is_also_a_token(self) -> None:
        self.assertIn("cafe_fune", self._tokens("紹介 @cafe_fune さん"))

    def test_hashtag_is_not_a_handle(self) -> None:
        self.assertEqual([], self._tokens("#lunchtime #大阪カフェ"))

    def test_url_is_not_a_handle(self) -> None:
        self.assertEqual([], self._tokens("https://instagram.com/cafe_fune/"))

    def test_digits_only_token_is_dropped(self) -> None:
        self.assertEqual([], self._tokens("2026.09.05 11.30"))

    def test_too_long_token_is_dropped(self) -> None:
        self.assertEqual([], self._tokens("a" * 31))

    def test_generic_word_is_in_the_stoplist(self) -> None:
        # `instagram` だけで実測 58,495 ペアの誤爆。ここが抜けると KPI が汚れる
        for word in ("instagram", "tokyo", "kitchen", "sunday"):
            self.assertIn(word, common_sns.GENERIC_HANDLE_STOPWORDS)


class SqlContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.p = FakePipeline()

    def test_stats_sql_keeps_pre_stoplist_cte(self) -> None:
        sql = mod_4_17.stats_sql(self.p)
        self.assertIn("cand_all AS (", sql)   # stoplist 適用前（誤爆率の分母）
        self.assertIn("cand AS (", sql)       # 適用後
        self.assertIn("FROM cand_all c JOIN handle_dict d", sql)

    def test_backfill_never_overwrites_existing_seed(self) -> None:
        sql = mod_4_17.backfill_sql(self.p, None)
        self.assertIn("UPDATE `proj.ds.sns_post_raw` r", sql)
        self.assertIn(
            "(r.discovery_seed_place_id IS NULL OR r.discovery_seed_place_id = '')", sql)
        # 1 投稿に 2 店当たったものは書かない
        self.assertIn("WHERE n_place = 1", sql)

    def test_backfill_limit_is_deterministic(self) -> None:
        self.assertIn("ORDER BY post_id LIMIT @row_limit",
                      mod_4_17.backfill_sql(self.p, 1000))
        self.assertNotIn("@row_limit", mod_4_17.backfill_sql(self.p, None))

    def test_dictionary_defaults_to_corroborated_only(self) -> None:
        strict = mod_4_17.stats_sql(self.p)
        wide = mod_4_17.stats_sql(self.p, corroborated_only=False)
        self.assertIn("AND corroborated", strict)
        self.assertIn("discovery_method != 'official_site_crawl'", strict)
        self.assertNotIn("AND corroborated", wide)
        self.assertNotIn("discovery_method != 'official_site_crawl'", wide)

    def test_chain_handles_are_never_resolved(self) -> None:
        # 同じ handle が 2 店以上に付いていたらチェーン公式。引き当てに使わない
        self.assertIn("HAVING COUNT(DISTINCT pid) = 1", mod_4_17.stats_sql(self.p))

    def test_new_accounts_use_the_full_dictionary(self) -> None:
        # «もう知っているか» の判定なので、裏取りの有無で絞らない
        sql = mod_4_17.new_accounts_sql(self.p)
        self.assertNotIn("AND corroborated", sql)
        self.assertIn("@min_posts", sql)
        self.assertIn("@min_posters", sql)


if __name__ == "__main__":
    unittest.main()
