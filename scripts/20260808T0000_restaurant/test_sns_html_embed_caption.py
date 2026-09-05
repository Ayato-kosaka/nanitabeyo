"""#1273 埋め込みページのキャプション抽出を、ネットワーク無しで固定する。

`captions_from_html`（第三者サイトが貼った blockquote 用）と
`caption_from_embed_html`（Instagram 公式の /embed/captioned/ 用）は **構造が違う**。
4_14 で前者を後者に使ってしまい、300 件取って 0 件だった。取り違えを二度としないよう、
«公式ページには blockquote が無い» ことも含めてテストで固定する。
"""

from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sns_html import caption_from_embed_html, captions_from_html  # noqa: E402

# 公式の /embed/captioned/ に出てくる形。blockquote は無く、本文は div.Caption の中。
# 先頭に投稿者 handle のリンク、末尾に «3 w» のような相対時刻が入る。
EMBED = """<html><body><div class="EmbedFrame">
<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/ramen_taro/">ramen_taro</a>
本日のおすすめは<a href="#">#豚骨ラーメン</a> です
<div class="CaptionComments"><div class="CaptionTime">3 w</div></div></div>
</div></body></html>""".encode("utf-8")


class EmbedCaptionTest(unittest.TestCase):
    def test_body_is_extracted(self) -> None:
        self.assertEqual(caption_from_embed_html(EMBED), "本日のおすすめは #豚骨ラーメン です")

    def test_username_and_time_are_not_part_of_the_caption(self) -> None:
        cap = caption_from_embed_html(EMBED) or ""
        self.assertNotIn("ramen_taro", cap)
        self.assertNotIn("3 w", cap)

    def test_attribute_order_does_not_matter(self) -> None:
        # 実物は属性の順が固定ではない。順に依存して壊れないこと
        html = EMBED.replace(
            b'<a class="CaptionUsername" href=', b'<a href="x" class="CaptionUsername" data-y=')
        self.assertEqual(caption_from_embed_html(html), "本日のおすすめは #豚骨ラーメン です")

    def test_missing_caption_returns_none(self) -> None:
        self.assertIsNone(caption_from_embed_html(b"<html><body>nope</body></html>"))
        self.assertIsNone(caption_from_embed_html(b'<div class="Caption"></div>'))

    def test_blockquote_extractor_cannot_read_the_embed_page(self) -> None:
        """取り違えの再発防止。公式ページに blockquote 用の抽出器は効かない。"""
        self.assertEqual(captions_from_html(EMBED), {})


if __name__ == "__main__":
    unittest.main()
