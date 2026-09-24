"""psycopg2 へ渡す SQL の中に **エスケープしていない `%`** が残っていないことを見る。

## 直した欠陥（2026-09-24 / #1666）

`inspect_opening_hours_reach.py` の `REACH_SQL` の **SQL コメントに日本語で
«19.7% で取れる» と書いた**ため、dev で
`psycopg2.ProgrammingError: argument formats can't be mixed` で落ちた
（[run 36014931919](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36014931919)）。

psycopg2 はパラメータを渡す `execute` で **SQL 文字列全体を «%» 書式として読む**。
`%(name)s` に混じって裸の `%` があると «位置指定と名前付きが混ざっている» と判断する。
コメントの中かどうかは見ていない。**書いた場所が SQL のコメントでも落ちる。**

⚠️ これは «測りに来たのに 1 件も数字が出ない» 形の事故である。しかも
**落ちるのは実行時だけ**で、テストも typecheck も素通りする。だから形で縛る。

## この検査の範囲

- 対象は «プレースホルダを持つ SQL 文字列»。プレースホルダが無いものは
  psycopg2 が params 無しで呼ばれ、`%` 書式の解釈が走らないので対象外
- 裸の `%` は `%%` へ直す（psycopg2 が `%` へ戻す）。文章を書き換えて `%` を
  消してもよいが、**数字の意味が落ちるので推奨しない**
"""

from __future__ import annotations

import io
import pathlib
import re
import tokenize
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

# 検査するディレクトリ。psycopg2 で PostgreSQL を触るスクリプトが居る場所
TARGET_DIRS = (
    REPO_ROOT / "scripts" / "db-checks",
    REPO_ROOT / "scripts" / "20260808T0000_restaurant",
)

# psycopg2 が «書式» として認めるもの。これ以外の `%` は事故
PLACEHOLDER = re.compile(r"%%|%s|%\(\w+\)s")

SQL_KEYWORDS = ("SELECT ", "INSERT ", "UPDATE ", "DELETE ", "WITH ")


def _looks_like_sql(text: str) -> bool:
    upper = text.upper()
    return any(keyword in upper for keyword in SQL_KEYWORDS)


def _string_tokens(path: pathlib.Path):
    """その .py の文字列リテラルを «行番号つき» で返す。

    ⚠️ **モジュール / 関数の docstring は除く。** docstring は psycopg2 へ渡らないので
    «SQL の書き方» の話をしている説明文の `%` まで落とすと、直し方を書けなくなる
    （この検査自身の docstring がまさにそれである）。
    """
    source = path.read_text(encoding="utf-8")
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    for index, token in enumerate(tokens):
        if token.type != tokenize.STRING:
            continue
        # docstring = 直前が INDENT / NEWLINE / ENCODING だけの «式文» の位置
        previous = next(
            (
                t
                for t in reversed(tokens[:index])
                if t.type
                not in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.COMMENT)
            ),
            None,
        )
        is_docstring = previous is None or previous.type == tokenize.ENCODING or (
            previous.type == tokenize.OP and previous.string == ":"
        )
        if is_docstring:
            continue
        yield token.start[0], token.string


def _offenders(path: pathlib.Path) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for lineno, literal in _string_tokens(path):
        if not _looks_like_sql(literal):
            continue
        if not PLACEHOLDER.search(literal):
            continue
        # 書式として正しいものを外してから、残った `%` を探す
        stripped = PLACEHOLDER.sub("", literal)
        for match in re.finditer("%", stripped):
            start = max(0, match.start() - 40)
            found.append((lineno, stripped[start : match.start() + 15].replace("\n", " ")))
    return found


class SqlPercentEscapingTest(unittest.TestCase):
    def test_no_unescaped_percent_in_parameterized_sql(self) -> None:
        offenders: list[str] = []
        for directory in TARGET_DIRS:
            for path in sorted(directory.rglob("*.py")):
                try:
                    hits = _offenders(path)
                except (tokenize.TokenError, IndentationError, SyntaxError):
                    continue
                for lineno, excerpt in hits:
                    offenders.append(
                        f"{path.relative_to(REPO_ROOT)}:{lineno} …{excerpt}… "
                        "（`%` は `%%` へ直すこと）"
                    )

        self.assertEqual(
            offenders,
            [],
            "プレースホルダを持つ SQL に裸の `%` が残っています。"
            "psycopg2 は SQL 全体を書式として読むので、コメントの中でも "
            "argument formats can't be mixed で落ちます:\n" + "\n".join(offenders),
        )

    def test_detects_a_planted_offender(self) -> None:
        """⚠️ **この検査が «何も見ていない» 状態へ静かに戻らないことを縛る。**

        対象ディレクトリのファイルを 1 つも拾えていなくても上のテストは緑になる。
        仕込んだ違反を検出できることを、実際の抽出関数で確かめる。
        """
        planted = REPO_ROOT / "scripts" / "db-checks" / "_planted_percent_sql.py"
        planted.write_text(
            'SQL = """\n'
            "  -- 19.7% で取れる\n"
            "  SELECT 1 WHERE x = %(a)s\n"
            '"""\n',
            encoding="utf-8",
        )
        try:
            hits = _offenders(planted)
            self.assertTrue(hits, "仕込んだ違反を検出できていない")
        finally:
            planted.unlink()

    def test_escaped_percent_is_accepted(self) -> None:
        """`%%` は通す（直し方が検査に落ちると、直せなくなる）。"""
        planted = REPO_ROOT / "scripts" / "db-checks" / "_planted_percent_ok.py"
        planted.write_text(
            'SQL = """\n'
            "  -- 19.7%% で取れる\n"
            "  SELECT 1 WHERE x = %(a)s\n"
            '"""\n',
            encoding="utf-8",
        )
        try:
            self.assertEqual(_offenders(planted), [])
        finally:
            planted.unlink()


if __name__ == "__main__":
    unittest.main()
