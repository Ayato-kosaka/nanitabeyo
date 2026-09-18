"""#1947 D. 埋め込みの死活判定を固定する。**推測で書くと必ず誤る箇所**を実測で較正してある。

## 何が問題だったか

配信は外部埋め込みなので、投稿が消えた瞬間にユーザーへ «壊れたもの» が届く。受け皿
（`embed_status` の列・索引・API・アプリの «利用できません» 表示）は**全部揃っていたのに、
それを書く処理だけが存在しなかった**。

2026-09-18 実測（配信カタログ `cat8` から無作為 202 件）: **削除済み 4.95%**
（95% CI 1.96〜7.94%）。約 26,700 配信行・約 3,300 店に相当する。

## 固定するもの（どれも実測で較正した）

1. **削除済みでも HTTP 200 が返る。** ステータスだけで判定する実装は «死亡ゼロ» と誤報する
2. **`unknown` を `dead` に寄せない。** provider が HTML を変えた日に、生きている投稿を
   一斉に «削除済み» と判定してしまう（`sns-oembed.service.ts` が同じ警告を書いている）
3. 判定は **`sns_html.caption_from_embed_html`（取り込みと同じ正本）** を通す。
   独自の正規表現を書くと «生きている» の定義が取り込み側とずれる
4. **キャプションが空でも生きている投稿がある** → `alive` に落とす（`dead` にしない）
5. 書き込み先は **BigQuery だけ**。PostgreSQL の `embed_status` へ触らない（UPDATE 承認待ち）
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "1273_instagram_seed_poc"))

_spec = importlib.util.spec_from_file_location(
    "probe_embed_liveness", HERE / "4_22_probe_embed_liveness.py")
m = importlib.util.module_from_spec(_spec)
sys.modules["probe_embed_liveness"] = m
_spec.loader.exec_module(m)

SOURCE = (HERE / "4_22_probe_embed_liveness.py").read_text(encoding="utf-8")

# --- 実物の形を最小限に写した固定値（2026-09-18 実測の本文から） -----------------
ALIVE_HTML = (
    '<html><body><div class="Caption">'
    '<a class="CaptionUsername">8888butch</a> '
    'BUTCH です 明日 18:00 より</div>'
    '<a>View profile</a><a>View more on Instagram</a></body></html>'
).encode("utf-8")
DEAD_HTML = (
    b'<html><body><p>The link to this photo or video may be broken, '
    b'or the post may have been removed.</p><a>Visit Instagram</a></body></html>'
)
ALIVE_NO_CAPTION_HTML = (
    b'<html><body><a>View profile</a><a>View more on Instagram</a></body></html>'
)
CHANGED_HTML = b'<html><body><div class="SomethingNew">hello</div></body></html>'


class ClassifyTest(unittest.TestCase):
    def test_alive_when_caption_is_present(self):
        self.assertEqual(m.classify(ALIVE_HTML, None)[0], "alive")

    def test_dead_only_on_the_removal_notice(self):
        liveness, evidence = m.classify(DEAD_HTML, None)
        self.assertEqual(liveness, "dead")
        self.assertEqual(evidence, "removal_notice")

    def test_alive_when_the_post_has_no_caption(self):
        """キャプションが空の投稿を «削除済み» にしない。"""
        liveness, evidence = m.classify(ALIVE_NO_CAPTION_HTML, None)
        self.assertEqual(liveness, "alive")
        self.assertEqual(evidence, "alive_ui_no_caption")

    def test_unknown_when_the_html_changes_shape(self):
        """provider が HTML を変えたら `unknown`。**`dead` に寄せない。**

        ここを `dead` にすると、仕様変更の日に生きている投稿が一斉に隠れる。
        """
        self.assertEqual(m.classify(CHANGED_HTML, None)[0], "unknown")

    def test_unknown_when_the_fetch_failed(self):
        liveness, evidence = m.classify(None, "TimeoutError: timed out")
        self.assertEqual(liveness, "unknown")
        self.assertIn("fetch_failed", evidence)

    def test_never_returns_dead_without_the_notice(self):
        """どんな «キャプション無し» でも、削除文言が無ければ dead にならない。"""
        for body in (b"", b"<html></html>", CHANGED_HTML, ALIVE_NO_CAPTION_HTML):
            with self.subTest(body=body[:24]):
                self.assertNotEqual(m.classify(body, None)[0], "dead")


class CalibrationIsRecordedTest(unittest.TestCase):
    """«HTTP 200 でも死んでいる» を、実装の中に書き残しておく。"""

    def test_the_http_200_trap_is_documented(self):
        self.assertIn("HTTP は 200 を返す", SOURCE)

    def test_it_reuses_the_canonical_embed_parser(self):
        """判定を写経しない。取り込みと同じ `caption_from_embed_html` を通す。"""
        self.assertIn("sns_html.caption_from_embed_html", SOURCE)

    def test_it_does_not_invent_its_own_caption_regex(self):
        self.assertNotIn('class="Caption"', SOURCE)


def _executable_source(path: Path) -> str:
    """docstring と `#` コメントを落とした «実際に動く部分» だけを返す。

    ⚠️ 素朴に全文を grep すると、**«PostgreSQL へ書かない» と説明している文章自体**に
    引っかかって落ちる（最初に書いたテストが実際にそうなった）。禁止事項の検査は
    コードに対して行う。
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    # docstring を空にしてから unparse する（コメントは ast が最初から持たない）
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body[0].value.value = ""
    return ast.unparse(tree)


class WritesOnlyToBigQueryTest(unittest.TestCase):
    """PostgreSQL へ触らないこと。`embed_status` の UPDATE はオーナー承認待ち。

    判定は **コード部分だけ**に対して行う（説明文に語が出るのは正しい）。
    """

    def setUp(self) -> None:
        self.code = _executable_source(HERE / "4_22_probe_embed_liveness.py")

    def test_no_postgres_driver(self):
        for forbidden in ("psycopg", "asyncpg", "sqlalchemy"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.code)

    def test_does_not_touch_embed_status(self):
        """`embed_status` へ書くのは別ステップ（オーナー承認待ち）。"""
        self.assertNotIn("embed_status", self.code)

    def test_no_update_or_delete_dml(self):
        upper = self.code.upper()
        for forbidden in ("UPDATE ", "DELETE FROM", "MERGE "):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, upper)

    def test_the_only_write_is_an_append(self):
        """書き込みは `load_json_rows`（WRITE_APPEND）と CREATE TABLE IF NOT EXISTS だけ。"""
        self.assertIn("load_json_rows", self.code)
        self.assertIn("CREATE TABLE IF NOT EXISTS", self.code)

    def test_it_creates_its_own_table_before_writing(self):
        create_at = SOURCE.index("CREATE_TABLE_SQL.replace")
        write_at = SOURCE.index("load_json_rows")
        self.assertLess(create_at, write_at, "書き込みより前に CREATE していない（#1970）")


class EmbedUrlIsFixedShapeTest(unittest.TestCase):
    """任意 URL を踏まない。post_id から固定の形しか作らない（SSRF を作らない）。"""

    def test_url_is_built_from_the_post_id_only(self):
        self.assertEqual(m.embed_url("ABC123"),
                         "https://www.instagram.com/p/ABC123/embed/captioned/")

    def test_no_url_column_is_fetched(self):
        """`canonical_url` を fetch に渡していないこと（列の中身は外部由来）。"""
        tree = ast.parse(SOURCE)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "fetch"):
                self.assertTrue(
                    any(isinstance(a, ast.Call) and getattr(a.func, "id", "") == "embed_url"
                        for a in node.args),
                    "fetch に embed_url() 以外を渡している")


class TimeBudgetTest(unittest.TestCase):
    def test_it_can_be_cut_by_time(self):
        self.assertIn("--max-minutes", SOURCE)
        self.assertIn("time.monotonic()", SOURCE)

    def test_it_flushes_before_breaking_out(self):
        loop_at = SOURCE.index("for i, t in enumerate(targets")
        break_at = SOURCE.index("break", loop_at)
        self.assertIn("flush()", SOURCE[loop_at:break_at])
        self.assertIn("flush(force=True)", SOURCE[break_at:])

    def test_default_interval_is_polite(self):
        """既定 1 req/sec。**測定であって収集ではない。**"""
        tree = ast.parse(SOURCE)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "add_argument" and node.args
                    and getattr(node.args[0], "value", None) == "--sleep-ms"):
                default = [k.value.value for k in node.keywords if k.arg == "default"][0]
                self.assertGreaterEqual(default, 1000)
                return
        self.fail("--sleep-ms が無い")


if __name__ == "__main__":
    unittest.main()
