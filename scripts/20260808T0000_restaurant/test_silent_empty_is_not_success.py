"""#1947 «相手が成功を返しながら中身を返さなくなった» を成功として数え続けない。

2026-09-25、`4_14`（キャプション後入れ）の run 1235 がこうなった。

| 取得した件数 | 本文あり | 空 | 失敗 |
| ---: | ---: | ---: | ---: |
| 3,500 | 2,245（64%） | 1,263 | 0 |
| 4,000 | 2,365 | 1,642 | 0 |
| **17,103** | **2,365（増えない）** | **14,738** | **0** |

4,000 件あたりから **13,100 件連続で本文が空**になり、それでも HTTP は 200・失敗 0 のまま
2 時間走り続けた。相手（Instagram の埋め込み）が静かに閉じたのに、道具はそれを成功として
数えていた。`--max-consecutive-errors` は **非 200 しか数えない**ので 1 度も引っかからない。

欠陥をパターンとして言い直すと «**中断の判定を «例外・非 200» だけで作っており、
«成功したが中身が無い» が素通りする**»。同じ形を外部 API を叩くループで全部当たり直した。

| script | 相手 | 判定 |
| --- | --- | --- |
| `4_14` | IG 埋め込み SSR | **当てはまる → 直した**（空が 300 連続で降りる） |
| `4_2` | IG business_discovery | **当てはまる → 直した**（0 件が 500 アカウント連続で降りる。実測: 0 件は 20.3%・自然な最長連続 221） |
| `4_20` | SERPER | **当てはまる → 直した**（0 件が 50 クエリ連続で降りる。クレジットを溶かすため） |
| `4_22` | IG 埋め込み SSR | **当てはまらない。** `--calibrate-first` と «判定できず率» の警告で «判定器が黙って壊れる» を既に見ている |
| `4_9` | Common Crawl の静的ファイル | **当てはまらない。** レート制限で静かに空を返す相手ではない |
| `4_12` | 多数のグルメ媒体 | **当てはまらない。** 1 つの相手ではなく host ごとに別。0 件の host は «済み» にもならない（行を書かないため）ので害が残らない |

⚠️ **どれも «回避策» は実装しない**（IP 分散などプラットフォームの制限を迂回する実装は禁止）。
入れたのは «気づいて止まる» だけである。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _load(name: str, fname: str):
    spec = importlib.util.spec_from_file_location(name, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


m414 = _load("m414s", "4_14_fetch_missing_captions.py")
m42 = _load("m42s", "4_2_collect_account_posts.py")


class TheCaptionBackfillNoticesASoftBlock(unittest.TestCase):
    def test_it_keeps_going_while_empties_are_normal(self) -> None:
        """ブロック前の実測は «空 36%» だった。数十件の空で降りてはいけない。"""
        self.assertIsNone(m414.soft_block_note(1, 100, 1))
        self.assertIsNone(m414.soft_block_note(299, 2245, 1263))

    def test_it_stops_once_the_streak_is_impossible_by_chance(self) -> None:
        note = m414.soft_block_note(300, 2365, 14738)
        self.assertIsNotNone(note)
        self.assertIn("300", note)

    def test_the_note_reports_the_hit_rate_not_just_the_streak(self) -> None:
        """«何件取れたか» が無いと、降りたあとに «再開してよいか» を判断できない。"""
        note = m414.soft_block_note(300, 2365, 14738)
        self.assertIn("%", note)
        self.assertIn("2365", note)

    def test_the_streak_resets_on_a_real_caption(self) -> None:
        """本文が 1 件取れたら連続はリセットされること（コードの形で固定する）。"""
        src = (HERE / "4_14_fetch_missing_captions.py").read_text(encoding="utf-8")
        i = src.index('state["ok"] += 1')
        self.assertIn('state["consecutive_empty"] = 0', src[i:i + 200])


class TheCollectorNoticesSilentZeroes(unittest.TestCase):
    def test_nothing_happens_within_the_observed_natural_streak(self) -> None:
        """実測の自然な最長連続は 221。そこでは止めても警告してもいけない。"""
        self.assertIsNone(m42.empty_streak_action(221))

    def test_it_warns_before_it_stops(self) -> None:
        self.assertEqual("warn", m42.empty_streak_action(250))
        self.assertEqual("stop", m42.empty_streak_action(500))

    def test_the_limit_is_well_above_what_happens_naturally(self) -> None:
        """観測された最長（221）の 2 倍以上あること。«正常なのに赤くする» 方が害が大きい。"""
        self.assertGreaterEqual(m42.MAX_CONSECUTIVE_EMPTY_ACCOUNTS, 221 * 2)


class NoGuardTriesToWorkAroundTheLimit(unittest.TestCase):
    """⚠️ 入れてよいのは «気づいて止まる» だけ。制限の迂回は実装しない。"""

    FORBIDDEN = ("proxy", "proxies", "rotate_ip", "user_agent_pool", "socks5")

    def test_no_script_gained_a_circumvention_knob(self) -> None:
        for name in ("4_14_fetch_missing_captions.py", "4_2_collect_account_posts.py",
                     "4_20_search_influencer_accounts.py"):
            src = (HERE / name).read_text(encoding="utf-8").lower()
            for bad in self.FORBIDDEN:
                with self.subTest(script=name, token=bad):
                    self.assertNotIn(bad, src)


if __name__ == "__main__":
    unittest.main()
