"""#1947 **数えるだけの実行が «0 だった» ことを失敗として返さない**ことを固定する。

## 何が起きたか（実測）

2026-09-30 19:39、`4_23 --dry-run` を «未達 21 地点に撃てる弾が本当に 0 なのか» を
道具自身に数えさせるために流した（run
[1534](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36767126157)）。
道具は正しく数え、内訳まで出した。

    合格線に足りない地点 = 21 件
    巡回対象（handle 未知・サイトあり・まだ巡っていない）= 0 店
      内訳: handle 未知 1477 店 = サイトあり 483 ＋ サイト無し 994
        サイトありの内訳: これから巡れる 0 ＋ もう巡って handle が出なかった 483

そのうえで `raise SystemExit(...)` で終了コード 1 を返し、**run が failure になった**。
レーンの見張り（`lanes.py`）は «直近の失敗: 1534» と赤く出す。

## パターンとして 1 文で

**数えることが目的の実行（`--dry-run` / `--report-only` / 測定 script）で、数えた結果が
0 だったことを非ゼロ終了で返すと、«正常なのに赤い» run ができ、本物の failure を隠す。**

CLAUDE.md は «判定できない状態を結果として報告するな» と «正常なのに赤くするガードも
同じくらい悪い» を並べて禁じている。今回は後者である。

⚠️ **«0 だから成功» ではない。** 区別は «測れたか» で付ける。

| 状況 | 終了コード |
| --- | --- |
| 数えて 0 だった（測れている） | **0**（メッセージは残す） |
| そもそも測れない（run_id 取り違え・配信 0 行・以降の比率の分母が 0） | 非ゼロのまま |
| 引数・環境変数の不備 | 非ゼロのまま |
| 書き込む実行で対象が 0（後段が対象行を前提にする） | 非ゼロのまま |

## 水平展開（`raise SystemExit` を全部当たった）

| 場所 | 判定 |
| --- | --- |
| `4_23` 「対象が 0 店」 | **当てはまる → 直した**（`--dry-run` は 0 で返す） |
| `4_23` 「足りない地点が 0 件」 | **当てはまる → 直した**（合格線に届いた瞬間に赤くなる） |
| `4_24` 「足りない地点が 0 件」 | **当てはまる → 直した**（`--report-only` は SERPER を呼ばない無料の測定） |
| `7_8` 「足りない地点が 0 件」 | **当てはまる → 直した**（測定 script。勝った瞬間に赤くなる） |
| `7_8` 「500m 圏に resolve 済みの投稿が 0」 | 当てはまらない（以降の比率の分母が 0 ＝ **測れない**） |
| `7_4` / `7_5` / `7_6` / `7_7` の «測定不能» ガード | 当てはまらない（run_id 取り違え・配信 0 行＝測れていない） |
| `4_24` 「SERPER_API_KEY が無い」 | 当てはまらない（環境不備。`--report-only` はこの行より前に return する） |
| `4_2` / `4_6` / `4_7` / `4_25` の SystemExit | 当てはまらない（引数の組み合わせの検査） |
| `5_1` の «入力が 1 件も新しくない» 門 | 当てはまらない（**走らせないことが目的**。`test_5_1_no_stale_round.py` が固定する） |
| `3_5_build` 「閉店群が 0 件」 | 当てはまらない（突き合わせの入力が作れていない＝測れない） |

## この test が固定すること

個別の文言ではなく **«測るだけの経路に、数えた 0 を理由にした非ゼロ終了を復活させない»**。
"""
from __future__ import annotations

import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent

# 「数えた結果が 0」を理由に落ちてはいけない場所。
#   script → (その経路を表すフラグ属性, その属性が真のときに 0 を返す行が要る)
MEASURE_ONLY = {
    "4_23_target_gap_point_stores.py": "args.dry_run",
    "4_24_search_store_handles.py": "args.report_only",
}

# 測定専用 script（フラグを問わず、数えた 0 は成功）
MEASURE_SCRIPTS = ("7_8_measure_gap_point_blocked.py",)

# 「数えた結果が 0」を言っている文言。これを含む SystemExit は上のガードが要る。
COUNTED_ZERO = re.compile(r"(足りない地点が 0 件|対象が 0 店)")

# 「測れない」側の文言。こちらは非ゼロで落ちてよい。
CANNOT_MEASURE = re.compile(r"(測定不能|測れ|1 件も無い|1 行も無い|未設定|渡されている)")


def _src(name: str) -> str:
    return (HERE / name).read_text(encoding="utf-8")


def _exit_sites(src: str) -> list[str]:
    """`raise SystemExit(...)` の呼び出しを、閉じ括弧まで 1 件ずつ返す。"""
    out: list[str] = []
    for m in re.finditer(r"raise SystemExit\(", src):
        i = m.end() - 1
        depth = 0
        for j in range(i, len(src)):
            if src[j] == "(":
                depth += 1
            elif src[j] == ")":
                depth -= 1
                if depth == 0:
                    out.append(src[m.start():j + 1])
                    break
    return out


class CountedZeroIsNotFailure(unittest.TestCase):
    def test_measure_only_paths_return_zero_before_raising(self) -> None:
        """`--dry-run` / `--report-only` の経路に «数えた 0» の非ゼロ終了を残さない。"""
        for name, flag in MEASURE_ONLY.items():
            src = _src(name)
            for site in _exit_sites(src):
                if not COUNTED_ZERO.search(site):
                    continue
                self.fail(
                    f"{name}: «数えた結果が 0» を raise SystemExit で返している。"
                    f"{flag} が真のときは return 0 にすること:\n{site}")
            # ガードが実際に書かれていること（文言だけ消して抜け道を作らせない）
            self.assertIn(f"if {flag}:", src,
                          f"{name}: {flag} で 0 を返す分岐が無い")

    def test_measure_scripts_never_fail_on_counted_zero(self) -> None:
        """測定 script は «数えた 0» で落ちない（勝った瞬間に赤くしない）。"""
        for name in MEASURE_SCRIPTS:
            src = _src(name)
            for site in _exit_sites(src):
                if COUNTED_ZERO.search(site):
                    self.fail(f"{name}: 測定 script が «数えた 0» で落ちている:\n{site}")

    def test_cannot_measure_guards_are_kept(self) -> None:
        """⚠️ 逆側。«測れない» のに 0 を返して «0 が答え» に見せてはいけない。"""
        keep = {
            "7_4_measure_neighborhood_313.py": 1,
            "7_5_measure_rank_coverage.py": 2,
            "7_6_measure_route_yield.py": 1,
            "7_7_measure_deep_dive_headroom.py": 1,
            "7_8_measure_gap_point_blocked.py": 1,
        }
        for name, least in keep.items():
            sites = [s for s in _exit_sites(_src(name)) if CANNOT_MEASURE.search(s)]
            self.assertGreaterEqual(
                len(sites), least,
                f"{name}: «測れない» ときに落ちるガードが {least} 件以上あるはずが {len(sites)} 件。"
                f"«正常なのに赤い» を直すつもりで «測れないのに緑» にしていないか")

    def test_the_three_messages_survive(self) -> None:
        """終了コードを変えても、判断の材料（内訳と次の手）を落とさない。"""
        self.assertIn("サイト無しの %d 店には巡回が届かない",
                      _src("4_23_target_gap_point_stores.py"))
        self.assertIn("巡回経路は尽きた", _src("4_23_target_gap_point_stores.py"))
        self.assertIn("既に達成している", _src("7_8_measure_gap_point_blocked.py"))


if __name__ == "__main__":
    unittest.main()
