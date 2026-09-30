"""#1947 **鎖の各段が «自分の出力を次に誰が読むか» を名指しする**ことを固定する。

## 何が起きたか（実測）

2026-09-30、キャプション後入れ（`4_14`）を第44〜第57 ラウンドまで回した。
本文は数千件取れた。しかし **後入れキャプションの解き直し
（`5_1 --post-ids-table sns_caption_backfilled`）を 04:34（run 1471）から 21:30 まで
17 時間流していなかった**。本文は «誰にも読まれないまま» 溜まり、店名キーの在庫
（`4_18` の «未問い合わせ»）は 11,569 → 7,297 → **2,247** へ減った。
その減り方を見て «在庫が枯れた» と読みかけた。**原因は在庫ではなく、鎖の 1 段の取り落としだった。**

## パターンとして 1 文で

**鎖の段が別々のレーン（別々の run）に分かれていると、ある段の出力が «次の段の入力» で
あることを、その段自身が言わない限り忘れる。**

無料経路の鎖は 4 段ある。段の間はすべて «表に書いて、次の run が読む» でつながっている。

    4_14（キャプション） ─→ sns_caption_backfilled  ─→ 5_1 --post-ids-table
    4_18（店名→place_id）─→ sns_name_place_lookup   ─→ 4_21
    4_21（店を投稿へ貼る）─→ sns_name_place_post_link ─→ 5_1 --post-ids-table
    5_1                  ─→ sns_post_resolved        ─→ 9_1（カタログ）

⚠️ `5_1 --post-ids-table` には **`--skip-resolved-anywhere` を付けてはいけない**
（付けると «既に解いた» 判定で全部飛ぶ）。名指しの文にこの注意を必ず含める。

## この test が固定すること

個別の文言ではなく **«鎖の段が、次の段のコマンドを名指しするログを持っている»**。
段を増やしたら、この test の表に足す。
"""
from __future__ import annotations

import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent

# script → (次の段として名指しすべき文字列, 5_1 の --post-ids-table 経路か)
CHAIN = {
    "4_14_fetch_missing_captions.py": ("5_1_apply_resolve.py", True),
    # 4_18 の次は 4_21。`--post-ids-table` の段はそこから先なので、注意は 4_21 が持つ
    "4_18_resolve_place_id_by_name.py": ("4_21_link_name_place_to_posts.py", False),
    "4_21_link_name_place_to_posts.py": ("5_1_apply_resolve.py", True),
}


class ChainNamesItsNextStep(unittest.TestCase):
    def test_each_stage_names_the_next_command(self) -> None:
        for name, (nxt, _) in CHAIN.items():
            src = (HERE / name).read_text(encoding="utf-8")
            self.assertTrue("次:" in src, f"{name}: 次の段を名指しするログが無い")
            self.assertTrue(nxt in src, f"{name}: 次の段として {nxt} を名指ししていない")

    def test_post_ids_table_paths_warn_about_skip_resolved_anywhere(self) -> None:
        """⚠️ `--post-ids-table` に `--skip-resolved-anywhere` を付けると全部飛ぶ。"""
        for name, (_, needs_warning) in CHAIN.items():
            if not needs_warning:
                continue
            src = (HERE / name).read_text(encoding="utf-8")
            self.assertTrue("--post-ids-table" in src,
                            f"{name}: 次の段の入口（--post-ids-table）を書いていない")
            self.assertTrue("--skip-resolved-anywhere" in src,
                            f"{name}: --skip-resolved-anywhere への注意が無い")

    def test_the_hint_is_logged_not_only_commented(self) -> None:
        """コメントに書いただけでは run のログに出ない＝忘れる。LOGGER から出すこと。"""
        for name in CHAIN:
            src = (HERE / name).read_text(encoding="utf-8")
            after = src[src.index("次:"):]
            head = src[:src.index("次:")]
            self.assertTrue("LOGGER." in head[-400:],
                            f"{name}: «次:» がログ呼び出しの中に無い（コメントだけになっている）")
            self.assertTrue(after, f"{name}: 空")

    def test_5_1_documents_the_same_rule_at_the_receiving_end(self) -> None:
        """受け側（`5_1`）の help も同じ注意を持っていること（片側だけ直さない）。"""
        src = (HERE / "5_1_apply_resolve.py").read_text(encoding="utf-8")
        self.assertTrue("sns_caption_backfilled" in src, "5_1: 入口の表名が help に無い")
        self.assertTrue("--skip-resolved-anywhere を付けない" in src,
                        "5_1: 受け側の help に «付けない» の注意が無い")


if __name__ == "__main__":
    unittest.main()
