#!/usr/bin/env python3
"""`rows_of` の scroll_index 復元だけを守るテスト。

ブラウザ側は「URL の挿入順の配列」と「各スクロール時点の**累計**件数」しか返さない。
ここを取り違えると «何回目に画面を送ったところで何件増えたか» が丸ごと狂い、
そのまま «1 万件で何時間» の見積もりが狂う。CSV は数え直しても同じにならないので、
壊れたまま出すと取り返しがつかない。
"""

import unittest

from build_post_url_csv import rows_of


class RowsOfTest(unittest.TestCase):
    def test_累計件数からスクロール回ごとに切り分ける(self) -> None:
        doc = {
            "provider": "tiktok",
            "keyword": "焼き鳥",
            "search_url": "https://www.tiktok.com/search?q=%E7%84%BC%E3%81%8D%E9%B3%A5",
            "urls": ["u0", "u1", "u2", "u3", "u4"],
            "steps": [
                {"scroll": 0, "cumulative": 2},
                {"scroll": 1, "cumulative": 2},  # 増えなかった回
                {"scroll": 2, "cumulative": 5},
            ],
        }
        rows = rows_of(doc, "2026-08-27T10:00:00Z")

        self.assertEqual([r["post_url"] for r in rows], ["u0", "u1", "u2", "u3", "u4"])
        self.assertEqual([r["scroll_index"] for r in rows], ["0", "0", "2", "2", "2"])
        self.assertTrue(all(r["search_keyword"] == "焼き鳥" for r in rows))
        self.assertTrue(all(r["collected_at"] == "2026-08-27T10:00:00Z" for r in rows))

    def test_累計が総数に届かなければ残りを最終スクロールへ寄せる(self) -> None:
        # LLM が HTML から拾った場合は累計が揃わないことがある。
        # 取りこぼして CSV の行数が減るほうが害が大きいので、落とさず最後へ寄せる。
        doc = {
            "provider": "instagram",
            "keyword": "焼き鳥",
            "search_url": "https://www.instagram.com/explore/tags/x/",
            "urls": ["a", "b", "c"],
            "steps": [{"scroll": 0, "cumulative": 1}],
        }
        rows = rows_of(doc, "")
        self.assertEqual([r["scroll_index"] for r in rows], ["0", "0", "0"])
        self.assertEqual(len(rows), 3)

    def test_収集できなかった場合は0行(self) -> None:
        doc = {"provider": "instagram", "blocked": True, "reason": "ログインが必要です"}
        self.assertEqual(rows_of(doc, ""), [])


if __name__ == "__main__":
    unittest.main()
