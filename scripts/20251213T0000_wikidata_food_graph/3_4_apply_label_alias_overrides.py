#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3_4_apply_label_alias_overrides.py

【目的】
BigQuery の dish_category_label_alias_overrides を dish_category_catalog に反映する。

【なぜ 3_4 として分けるか】
3_2_refresh_dish_category_catalog_core.py は Wikidata の core 情報を取り直し、
label_ja / label_en / labels_json / aliases_json を Wikidata 値で上書きする。
そのため、dish_category_catalog を手で直接 UPDATE しても、次回 3_2 で元に戻る。

このスクリプトは「Wikidata 生値を取り込んだ後に、Nanitabeyo の運用上の代表名・別名へ
補正する」ための後段ステップである。

【処理内容】
1. dish_category_label_alias_overrides を取得
2. apply_to_label=true が同一 item_qid + locale に複数ないことを検証
3. 対象 dish_category_catalog 行の labels_json / aliases_json を Python 側で安全に編集
4. 一時テーブルにロードして dish_category_catalog へ MERGE

【反映ルール】
- apply_to_label=true:
  - surface_form を対象 locale の代表 label に昇格する
  - locale=ja なら label_ja も更新する
  - locale=en なら label_en も更新する
  - 上書き前の元 label は aliases_json[locale] に追加して保持する
- apply_to_label=false:
  - 代表 label は変更せず、surface_form を aliases_json[locale] に追加する
- 新 label が aliases_json に既に存在していても削除しない
  - 現状 4_1_generate_variants.py は aliases_json を読まない
  - 将来 aliases 由来 variants を生成する場合も、重複除外で扱えばよい

【使用方法】
python3 3_4_apply_label_alias_overrides.py
python3 3_4_apply_label_alias_overrides.py --dry-run
"""

import argparse
import json
import logging
import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

sys.path.append(str(Path(__file__).parent))
from loader_bigquery import BigQueryLoader


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"


def parse_json_object(raw_value: Optional[str], *, field_name: str, item_qid: str) -> Dict[str, Any]:
    """
    JSON 文字列を dict として読む。

    BigQuery 側では labels_json / aliases_json が STRING として保持されている。
    ここで壊れた JSON を無視してしまうと、既存の多言語 label/alias を失う可能性がある。
    そのため parse 不能な場合は明示的に失敗させる。
    """
    if not raw_value:
        return {}

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"{field_name} is invalid JSON for item_qid={item_qid}: {exc}"
        ) from exc

    if not isinstance(parsed, dict):
        raise ValueError(
            f"{field_name} must be a JSON object for item_qid={item_qid}, got {type(parsed).__name__}"
        )

    return parsed


def add_alias(aliases: Dict[str, Any], locale: str, surface_form: Optional[str]) -> None:
    """
    aliases_json[locale] に surface_form を重複なしで追加する。

    aliases_json は {"ja": ["別名1", "別名2"]} 形式を期待する。
    現時点では 4_1_generate_variants.py が aliases_json を読まないため、代表 label と alias に
    同じ文字列が共存しても実害はない。ただし alias 配列内の重複は人間が見た時のノイズにしか
    ならないので、ここで防ぐ。
    """
    if not surface_form:
        return

    existing = aliases.get(locale)
    if existing is None:
        alias_list: List[str] = []
    elif isinstance(existing, list):
        if not all(isinstance(value, str) for value in existing):
            raise ValueError(
                f"aliases_json['{locale}'] must contain only strings"
            )
        alias_list = list(existing)
    else:
        raise ValueError(
            f"aliases_json['{locale}'] must be an array, got {type(existing).__name__}"
        )

    if surface_form not in alias_list:
        alias_list.append(surface_form)

    aliases[locale] = alias_list


def get_current_label(item: Dict[str, Any], labels: Dict[str, Any], locale: str) -> Optional[str]:
    """
    対象 locale の現在の代表 label を取得する。

    ja/en は dish_category_catalog に label_ja / label_en という専用列もあるため、
    JSON よりも専用列を優先して「降格すべき元 label」を決める。
    その他 locale は labels_json の値だけを見る。
    """
    if locale == "ja":
        return item.get("label_ja") or labels.get(locale)
    if locale == "en":
        return item.get("label_en") or labels.get(locale)

    value = labels.get(locale)
    return value if isinstance(value, str) else None


def apply_override_to_item(item: Dict[str, Any], override: Dict[str, Any]) -> None:
    """
    1件の override を 1件の catalog item に反映する。

    この関数は item dict を in-place で更新する。複数 override が同じ item にある場合、
    事前に順序付けした順で順次適用する。
    """
    locale = override["locale"]
    surface_form = override["surface_form"]
    apply_to_label = bool(override["apply_to_label"])

    labels = item["labels"]
    aliases = item["aliases"]

    if apply_to_label:
        current_label = get_current_label(item, labels, locale)

        # 代表 label を上書きする場合、元の代表 label を alias に降格して保持する。
        # これにより Wikidata の正式名を失わず、将来 aliases 由来 variants を有効化した時にも拾える。
        if current_label and current_label != surface_form:
            add_alias(aliases, locale, current_label)

        labels[locale] = surface_form

        # ja/en は catalog に専用列があり、9_1_sync_dish_categories.py や
        # localized text の入力 SQL が参照するため JSON と同時に揃える。
        if locale == "ja":
            item["label_ja"] = surface_form
        elif locale == "en":
            item["label_en"] = surface_form
    else:
        # label へ昇格しない補正は、単純に alias として追加する。
        # 例: 別表記・略称・日本で使われる呼称を検索補助として保持する用途。
        add_alias(aliases, locale, surface_form)


def fetch_overrides(loader: BigQueryLoader) -> List[Dict[str, Any]]:
    """
    補正ルールを BigQuery から取得する。

    ORDER BY は、人間が後から追いやすい determinism のために入れている。
    apply_to_label=true は item_qid + locale ごとに 1件だけ許可するが、
    apply_to_label=false の alias 追加は複数件あってよい。
    """
    sql = f"""
    SELECT
      item_qid,
      locale,
      surface_form,
      apply_to_label,
      source,
      note,
      created_at,
      updated_at
    FROM `{loader.dataset_ref}.dish_category_label_alias_overrides`
    WHERE item_qid IS NOT NULL
      AND locale IS NOT NULL
      AND surface_form IS NOT NULL
      AND surface_form != ''
    ORDER BY item_qid, locale, apply_to_label DESC, updated_at, created_at, surface_form
    """

    rows = list(loader.client.query(sql).result())
    overrides = [
        {
            "item_qid": row.item_qid,
            "locale": row.locale,
            "surface_form": row.surface_form,
            "apply_to_label": row.apply_to_label,
            "source": row.source,
            "note": row.note,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]
    logger.info("Fetched %d label/alias overrides", len(overrides))
    return overrides


def validate_overrides(overrides: List[Dict[str, Any]]) -> None:
    """
    override の矛盾を検出する。

    代表 label は locale ごとに 1つしか選べないため、apply_to_label=true が
    同一 item_qid + locale に複数ある場合は即エラーにする。
    ここを暗黙に最新優先などにすると、BigQuery テーブルを見ただけでは採用理由が追いにくくなる。
    """
    label_promotions: Dict[tuple, List[str]] = defaultdict(list)

    for override in overrides:
        if override["apply_to_label"]:
            key = (override["item_qid"], override["locale"])
            label_promotions[key].append(override["surface_form"])

    conflicts = {
        key: values
        for key, values in label_promotions.items()
        if len(values) > 1
    }
    if conflicts:
        details = "; ".join(
            f"{item_qid}/{locale}: {values}"
            for (item_qid, locale), values in sorted(conflicts.items())
        )
        raise ValueError(
            "Multiple apply_to_label=true overrides found for the same item_qid + locale. "
            f"Resolve manually before applying: {details}"
        )


def fetch_catalog_items(loader: BigQueryLoader, item_qids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    override 対象の dish_category_catalog 行だけ取得する。

    補正対象が catalog に存在しない場合は、補正しても Serving へ届かない。
    そのため後段で missing をエラーにして、QID の取り込み漏れに気づけるようにする。
    """
    if not item_qids:
        return {}

    sql = f"""
    SELECT
      item_qid,
      label_ja,
      label_en,
      labels_json,
      aliases_json
    FROM `{loader.dataset_ref}.dish_category_catalog`
    WHERE item_qid IN UNNEST(@item_qids)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ArrayQueryParameter("item_qids", "STRING", item_qids),
        ]
    )

    rows = list(loader.client.query(sql, job_config=job_config).result())
    items: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        labels = parse_json_object(
            row.labels_json,
            field_name="labels_json",
            item_qid=row.item_qid,
        )
        aliases = parse_json_object(
            row.aliases_json,
            field_name="aliases_json",
            item_qid=row.item_qid,
        )
        items[row.item_qid] = {
            "item_qid": row.item_qid,
            "label_ja": row.label_ja,
            "label_en": row.label_en,
            "labels": labels,
            "aliases": aliases,
        }

    logger.info("Fetched %d catalog items for overrides", len(items))
    return items


def build_updated_catalog_rows(
    overrides: List[Dict[str, Any]],
    items: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    override を catalog item に適用し、BigQuery にロードしやすい形へ整形する。
    """
    missing_qids = sorted({o["item_qid"] for o in overrides} - set(items.keys()))
    if missing_qids:
        raise ValueError(
            "Override targets are missing from dish_category_catalog: "
            + ", ".join(missing_qids)
        )

    for override in overrides:
        apply_override_to_item(items[override["item_qid"]], override)

    updated_rows = []
    for item_qid in sorted({o["item_qid"] for o in overrides}):
        item = items[item_qid]
        updated_rows.append(
            {
                "item_qid": item_qid,
                "label_ja": item.get("label_ja"),
                "label_en": item.get("label_en"),
                "labels_json": json.dumps(
                    item["labels"],
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
                "aliases_json": json.dumps(
                    item["aliases"],
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            }
        )

    return updated_rows


def load_temp_rows(loader: BigQueryLoader, rows: List[Dict[str, Any]]) -> str:
    """
    更新後の catalog 断片を BigQuery 一時テーブルへロードする。

    insert_rows_json ではなく Load Job を使う。既存の 3_2 と同じく、まとまった JSONL を
    BigQuery に渡す方がエラーの見通しが良く、リトライもしやすい。
    """
    temp_table_id = f"{loader.dataset_ref}.temp_label_alias_overrides_applied"
    logger.info("Creating temp table: %s", temp_table_id)

    try:
        loader.client.delete_table(temp_table_id)
        logger.info("Deleted existing temp table: %s", temp_table_id)
    except Exception:
        pass

    schema = [
        bigquery.SchemaField("item_qid", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("label_ja", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("label_en", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("labels_json", "STRING", mode="NULLABLE"),
        bigquery.SchemaField("aliases_json", "STRING", mode="NULLABLE"),
    ]
    loader.client.create_table(bigquery.Table(temp_table_id, schema=schema))

    temp_file_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".jsonl",
            delete=False,
        ) as temp_file:
            temp_file_path = temp_file.name
            for row in rows:
                temp_file.write(json.dumps(row, ensure_ascii=False) + "\n")

        file_size_mb = os.path.getsize(temp_file_path) / (1024 * 1024)
        logger.info(
            "Loading %d rows to %s via JSONL Load Job (%.2f MB)",
            len(rows),
            temp_table_id,
            file_size_mb,
        )

        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema,
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        )
        with open(temp_file_path, "rb") as source_file:
            load_job = loader.client.load_table_from_file(
                source_file,
                temp_table_id,
                job_config=job_config,
            )
        load_job.result()

        if load_job.errors:
            raise RuntimeError(f"Load job completed with errors: {load_job.errors}")

        return temp_table_id
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)


def merge_updated_rows(loader: BigQueryLoader, temp_table_id: str) -> int:
    """
    一時テーブルから dish_category_catalog に MERGE する。

    ここでは label_ja / label_en / labels_json / aliases_json だけを触る。
    image_url, tags, roots など他ステップの責務には手を出さない。
    """
    target_table_id = f"{loader.dataset_ref}.dish_category_catalog"
    sql = f"""
    MERGE `{target_table_id}` AS target
    USING `{temp_table_id}` AS source
    ON target.item_qid = source.item_qid
    WHEN MATCHED THEN
      UPDATE SET
        label_ja = source.label_ja,
        label_en = source.label_en,
        labels_json = source.labels_json,
        aliases_json = source.aliases_json
    """
    return loader.execute_dml(sql)


def apply_label_alias_overrides(loader: BigQueryLoader, dry_run: bool = False) -> int:
    """
    label / alias override を適用するメイン処理。

    Returns:
        更新対象 item 数
    """
    overrides = fetch_overrides(loader)
    if not overrides:
        logger.info("No label/alias overrides found. Nothing to apply.")
        return 0

    validate_overrides(overrides)

    item_qids = sorted({override["item_qid"] for override in overrides})
    items = fetch_catalog_items(loader, item_qids)
    updated_rows = build_updated_catalog_rows(overrides, items)

    if dry_run:
        logger.info("[DRY-RUN] Would update %d dish_category_catalog rows", len(updated_rows))
        for row in updated_rows[:20]:
            logger.info(
                "[DRY-RUN] item_qid=%s label_ja=%s label_en=%s labels_json=%s aliases_json=%s",
                row["item_qid"],
                row["label_ja"],
                row["label_en"],
                row["labels_json"],
                row["aliases_json"],
            )
        if len(updated_rows) > 20:
            logger.info("[DRY-RUN] ... and %d more rows", len(updated_rows) - 20)
        return len(updated_rows)

    temp_table_id = load_temp_rows(loader, updated_rows)
    affected = merge_updated_rows(loader, temp_table_id)
    logger.info("Applied label/alias overrides to %d rows", affected)
    return affected


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply manual label/alias overrides to dish_category_catalog"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="変更内容をログ出力するだけで BigQuery へ MERGE しない",
    )
    args = parser.parse_args()

    logger.info("=" * 80)
    logger.info("Applying dish_category label/alias overrides")
    logger.info("=" * 80)
    logger.info("Project: %s, Dataset: %s", GCP_PROJECT, BQ_DATASET)
    logger.info("Dry-run: %s", args.dry_run)

    loader = BigQueryLoader(GCP_PROJECT, BQ_DATASET)

    try:
        apply_label_alias_overrides(loader, dry_run=args.dry_run)
        logger.info("=" * 80)
        logger.info("✅ Label/alias overrides applied successfully")
        logger.info("=" * 80)
    except Exception as exc:
        logger.error("❌ Failed to apply label/alias overrides: %s", exc, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
