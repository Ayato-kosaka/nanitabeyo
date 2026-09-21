"""#1947 «行が起きた時刻» の列に run の開始時刻を焼き付けない、を固定する。

## 欠陥をパターンで 1 文にすると

**«その行が起きた時刻» の列へ、run の先頭で 1 度だけ取った時刻を全行に入れていた。**

2026-09-21 に `5_1` で発見した。5.5 時間の run が書いた **65 万行すべてが同じ
`resolved_at`** を持っていた（`MIN(resolved_at) = MAX(resolved_at)`）。実害は 2 つ。

1. **«その投稿の現在の正» を選ぶ判定が壊れる。** `LATEST_RESOLVED_QUALIFY` や
   `ORDER BY fetched_at DESC` は «いちばん新しい行» を選ぶための式だが、run 単位の
   時刻だと **後から出した結果より、先に始まった別 run の古い結果が勝つ**ことがある
   （同じシャードを跨いで走った e-run と f-run で実際に重なっていた）。
   実測で `sns_post_raw` は **221,126 投稿が複数行**を持ち、うち **200,057 は run をまたぐ**。
   この判定は日常的に使われている。
2. **進み方が測れない。** «1 時間あたり何件解けたか» を表から出せず、
   «間に合うか» に答えられない（実際にこの測定ができずに詰まった）。

## 固定するもの

行を作るところで **その場で時刻を取る**こと。`main()` の先頭で取った変数を
行の辞書へ入れ直さないこと。
"""

from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# «その行が起きた時刻» を表す列。ここへ run 単位の変数を入れてはいけない。
EVENT_TIME_COLUMNS = frozenset({
    "fetched_at", "resolved_at", "crawled_at", "discovered_at", "attempted_at",
})

# --- 掃いた箇所の判定表 -----------------------------------------------------------
#
# ⚠️ **空にしない。** «当てはまらない» の理由を消すと、次の人がまた同じ調査をする。
SWEPT_SITES: tuple[tuple[str, bool, str], ...] = (
    ("5_1_apply_resolve.py", True, "**発見箇所**。5.5h の run 65 万行が同一 resolved_at"),
    ("4_2_collect_account_posts.py", True, "5h の収集。fetched_at / attempted_at の両方"),
    ("4_7_collect_search_api_posts.py", True, "長時間の収集ループ"),
    ("4_3_collect_search_posts.py", True, "SERPER を回すループ"),
    ("4_4_crawl_official_site_igs.py", True, "巡回は数時間。使わなくなった引数も落とした"),
    ("4_1c_foursquare_store_accounts.py", True,
     "discovered_at は 4_7 が «そのハンドルの最新の発見» を選ぶのに使う"),
    ("4_18_resolve_place_id_by_name.py", True,
     "main 側の resolved_at。3_3 が attempted_at DESC で最新を選ぶ"),
    # ⚠️ ここから下の 6 本は **手で grep したときに見落としており、このテストが見つけた**。
    #    «同じ形» を人手で数え切れると思わないこと。
    ("4_10_scan_store_site_embeds.py", True, "走査ループ。手の sweep では見落とした"),
    ("4_12_crawl_gourmet_media.py", True, "巡回ループ。同上"),
    ("4_16_target_near_cells.py", True, "discovered_at / crawled_at の 2 箇所。同上"),
    ("4_5_collect_cc_instagram_posts.py", True, "同上"),
    ("4_6_collect_wayback_instagram_posts.py", True, "同上"),
    ("4_9_scan_cc_wat_instagram.py", True, "fetched_at / discovered_at の 2 箇所。同上"),
    ("4_17_resolve_bare_handles.py", False,
     "**当てはまらない。** 行を作る関数にループが無く、1 回の集計結果を書くだけ"),
    ("4_19_rank_account_candidates.py", False,
     "**当てはまらない。** `computed_at` は «この計算をした時刻» で、run 単位が正しい意味"),
    ("9_1_build_sns_dish_media_catalog.py", False,
     "**当てはまらない。** カタログは «その時点のスナップショット» なので run 単位が正"),
)


def _production_files() -> list[Path]:
    return [p for p in sorted(HERE.glob("*.py"))
            if not p.name.startswith("test_") and p.name != "conftest.py"]


class EventTimeIsTakenAtRowBuildTimeTest(unittest.TestCase):
    """行の辞書に «run 単位の変数» を入れていないこと。"""

    def test_no_bare_name_is_stored_into_an_event_time_column(self) -> None:
        offenders = []
        for path in _production_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Dict):
                    continue
                for key, value in zip(node.keys, node.values):
                    if not (isinstance(key, ast.Constant) and key.value in EVENT_TIME_COLUMNS):
                        continue
                    # 値が «その場で呼ぶ» 形（Call）なら OK。変数名そのままは NG。
                    if isinstance(value, ast.Name):
                        offenders.append(f"{path.name}:{value.lineno} {key.value} <- {value.id}")
        self.assertEqual(
            [], offenders,
            "run 単位の変数を «行が起きた時刻» へ入れている。その場で utc_now() を呼ぶこと:\n"
            + "\n".join(offenders))

    def test_keyword_form_is_covered_too(self) -> None:
        """`dict(a, attempted_at=now, ...)` の形でも同じ（見落としやすい）。"""
        offenders = []
        for path in _production_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                for kw in node.keywords:
                    if kw.arg in EVENT_TIME_COLUMNS and isinstance(kw.value, ast.Name):
                        offenders.append(f"{path.name}:{kw.value.lineno} {kw.arg} <- {kw.value.id}")
        # ⚠️ 既知の許容: 4_18 の `_write_extract_attempts` は **flush ごと**に取り直しており、
        #    run 単位ではない。ここを «違反» にすると直す方向が逆になるので除外する。
        offenders = [o for o in offenders if not o.startswith("4_18_resolve_place_id_by_name.py")]
        self.assertEqual([], offenders, "\n".join(offenders))


class SweptSitesAreRecordedTest(unittest.TestCase):
    def test_table_is_not_emptied(self) -> None:
        self.assertGreaterEqual(len(SWEPT_SITES), 16)
        self.assertTrue(any(a for _, a, _ in SWEPT_SITES))
        self.assertTrue(any(not a for _, a, _ in SWEPT_SITES))

    def test_every_swept_file_exists(self) -> None:
        for name, _, _ in SWEPT_SITES:
            self.assertTrue((HERE / name).exists(), f"{name} が無い（改名したら表も直す）")

    def test_every_entry_has_a_reason(self) -> None:
        for name, _, why in SWEPT_SITES:
            self.assertTrue(why.strip(), f"{name} に理由が無い")


if __name__ == "__main__":
    unittest.main()
