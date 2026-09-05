"""#1273 «絵を 1 枚も出せないカテゴリへ配って真っ黒なセルを作る» を二度と戻さないための固定。

BigQuery へは繋がない。固定するのは «壊れても実行は成功してしまう» 契約だけ。

欠陥をパターンで言い直すと **«最後の受け皿は必ず埋まっていると仮定して、
埋まっているかを一度も数えなかった»**。取り込み投稿は自ストレージにも provider にも
サムネイルを持たないので、画面に絵を出す最後の受け皿は料理カテゴリの絵しか無い
（`api/src/v1/dish-media/dish-media.assembler.ts` の `thumbnailImageUrl`）。
そこが空文字のカテゴリへ配ると、セルは絵も動画も無い真っ黒になる。

実測（dev / 2026-09-05）:

| 数えたもの | 値 |
| --- | --- |
| usable な dish_media | 145,392 行 |
| うち 3 段とも絵が無い（真っ黒） | **3,119 行（2.15%）** |
| その料理カテゴリ | 221 種類（**JP ゲートの 134 カテゴリには 1 つも無い**） |
| 配信カタログ側で落ちる行（sns-catalog-2026-09-05b） | 3,144 / 141,186（2.23%）・223 カテゴリ |
| そのうち KPI（JP ゲート）に効く行 | **0 行 / 0 組** |

再現手順は `scripts/db-checks/measure_delivered_but_invisible.py`（読み取り専用）。

⚠️ 個別の QID ではなく **この形**を固定する。«絵の有無で配信を止める» 判定が
`common_sns` の 1 箇所から消えたら、このテストが落ちる。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common_sns  # noqa: E402


class CategoryWithImageCteTest(unittest.TestCase):
    """`common_sns.category_with_image_cte_sql` の «契約»。"""

    def setUp(self) -> None:
        self.sql = common_sns.category_with_image_cte_sql("proj.ds.dish_category_images")

    def test_empty_string_is_treated_as_missing(self) -> None:
        """絵が無いことは NULL ではなく **空文字**で来る。

        PostgreSQL 側の `dish_categories.image_url` は NOT NULL で、
        `9_1_sync_dish_categories.py` が `COALESCE(rep.image_url, '')` で作る。
        NULL だけを弾くと «空文字のカテゴリ» を通してしまい、真っ黒がそのまま戻る。
        """
        self.assertIn("image_url IS NOT NULL", self.sql)
        self.assertIn("image_url != ''", self.sql)

    def test_reads_the_same_table_the_pg_sync_reads(self) -> None:
        """判定の材料は PG の同期元と同じ表であること（別の表を見ると PG とずれる）。"""
        self.assertEqual(common_sns.TABLE_DISH_CATEGORY_IMAGES, "dish_category_images")
        self.assertIn("proj.ds.dish_category_images", self.sql)

    def test_exposes_only_the_category_id(self) -> None:
        """JOIN の相手として使うので、列は 1 本だけにする（重複で行が増えないよう DISTINCT）。"""
        self.assertIn("SELECT DISTINCT dish_category_id", self.sql)

    def test_cte_name_is_overridable_but_defaults_to_the_shared_one(self) -> None:
        self.assertTrue(self.sql.startswith("category_with_image AS ("))
        self.assertTrue(
            common_sns.category_with_image_cte_sql("t", cte_name="other").startswith("other AS (")
        )


class CatalogBuilderDropsImagelessCategoriesTest(unittest.TestCase):
    """配る側（9_1）が判定を使い続けていること。

    ここが外れると «取ったのに真っ黒» が黙って戻る。差分レビューでは
    «書かれるべきなのに存在しないコード» を指摘できないので、テストで縛る。
    """

    def setUp(self) -> None:
        self.src = (HERE / "9_1_build_sns_dish_media_catalog.py").read_text(encoding="utf-8")

    def test_builder_joins_the_shared_gate(self) -> None:
        self.assertIn("category_with_image_cte_sql(", self.src)
        self.assertIn(
            "JOIN category_with_image ci ON ci.dish_category_id = v.dish_category_id", self.src
        )

    def test_builder_does_not_rewrite_the_rule_inline(self) -> None:
        """判定を 9_1 の中へ書き直さない（写経した複製は片方だけ直る）。"""
        code = "\n".join(
            line for line in self.src.splitlines() if not line.strip().startswith("#")
        )
        self.assertNotIn("dish_category_images`", code.replace(
            "category_with_image_cte_sql(images_table)", ""
        ))

    def test_dropped_rows_are_counted_not_silently_lost(self) -> None:
        """落とした数を run ログへ残す。«黙って減る» のが一番まずい。"""
        self.assertIn("no_category_image_posts", self.src)
        self.assertIn("no_category_image_categories", self.src)
        self.assertIn("dropped_no_category_image_posts", self.src)


if __name__ == "__main__":
    unittest.main()
