#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_common.py

【目的】
manual/ 配下の insert / merge スクリプトで共有する定数・validation・BigQuery ヘルパー。

【責務】
- wikidata_food_llm_feature_scores への手動 correction が満たすべき contract を一箇所に定義する
- CLI 単発入力と --input-jsonl の validation ロジックを共通化する（issue #1383 要求）
- BigQuery Client 生成、run_id 存在確認などの小さいヘルパー

このモジュール単体は BigQuery への書き込みを行わない（読み取り専用ヘルパーのみ）。
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

logger = logging.getLogger(__name__)

GCP_PROJECT = "food-scroll"
BQ_DATASET = "wikidata_food_graph"
DATASET_REF = f"{GCP_PROJECT}.{BQ_DATASET}"

SCORES_TABLE = f"{DATASET_REF}.wikidata_food_llm_feature_scores"
CATALOG_FEATURES_TABLE = f"{DATASET_REF}.dish_category_features_catalog"
CATALOG_TABLE = f"{DATASET_REF}.dish_category_catalog"

# relevance feature は 0 / 0.5 / 1 の離散値のみ許可する（#581 の契約に合わせる）。
ALLOWED_SCORES = {0.0, 0.5, 1.0}

# #1637 【仕様】連続値で運用されている feature_type。
#
# 当初は「manual correction の score は 0 / 0.5 / 1 のみ」という契約だったが、実データは
# そうなっていない。catalog の note に残っているレビュー確定値と実際の score を突き合わせると、
# 離散 feature（budget_intent / dining_pace / core_ingredient）は 288 行すべて一致するのに対し、
# 下記 5 種は 655 行すべて不一致で、実際には 0.42〜0.98 の連続値が入っている。
#
# つまり離散前提の検証だけが実態と合っていない。ここに挙げた型に限り 0.0〜1.0 の連続値を許す。
# **既定は従来どおり離散**なので、新しい feature を足すときに緩む方向へは倒れない。
CONTINUOUS_FEATURE_TYPES = {
    "market_salience",
    "dine_out_orderability",
    "timeSlot",
    "scene",
    "taste",
    "season",  # #737 で追加。月指数をそのまま入れるので連続
}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
REASON_MAX_CHARS = 120

DEFAULT_PHASE = "manual"
DEFAULT_MODEL = "manual"
DEFAULT_TASK = "#1383_manual_relevance_scoring"


@dataclass
class Correction:
    """1件の manual feature correction。"""

    item_qid: str
    feature_type: str
    feature_key: str
    score: float
    confidence: str
    reason: str
    task: str = DEFAULT_TASK

    def key(self) -> tuple:
        return (self.item_qid, self.feature_type, self.feature_key)


@dataclass
class ValidationResult:
    corrections: List[Correction] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def get_bq_client() -> bigquery.Client:
    return bigquery.Client(project=GCP_PROJECT)


def parse_single_correction(args) -> List[Dict[str, Any]]:
    """argparse Namespace（単発CLI引数）から1件のcorrection dictを作る。"""
    return [
        {
            "item_qid": args.item_qid,
            "feature_type": args.feature_type,
            "feature_key": args.feature_key,
            "score": args.score,
            "confidence": args.confidence,
            "reason": args.reason,
            "task": args.task,
        }
    ]


def parse_jsonl_corrections(path: str) -> List[Dict[str, Any]]:
    """--input-jsonl から correction dict のリストを読む。"""
    rows: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{lineno}: invalid JSON ({e})")
    return rows


def _coerce_score(
    raw: Any, where: str, errors: List[str], feature_type: str = ""
) -> Optional[float]:
    try:
        score = float(raw)
    except (TypeError, ValueError):
        errors.append(f"{where}: score '{raw}' is not a number")
        return None
    # 浮動小数の誤差を吸収してから許可値集合と突き合わせる
    rounded = round(score, 4)

    if feature_type in CONTINUOUS_FEATURE_TYPES:
        if not (-1e-6 <= rounded <= 1 + 1e-6):
            errors.append(
                f"{where}: score {raw} is out of range for continuous feature "
                f"'{feature_type}' (0.0〜1.0 のみ許可)"
            )
            return None
        return min(max(rounded, 0.0), 1.0)

    if not any(abs(rounded - allowed) < 1e-6 for allowed in ALLOWED_SCORES):
        errors.append(
            f"{where}: score {raw} is not in allowed set {sorted(ALLOWED_SCORES)} "
            f"(離散 feature '{feature_type}' は 0 / 0.5 / 1 のみ許可。"
            f"連続値を使えるのは {sorted(CONTINUOUS_FEATURE_TYPES)})"
        )
        return None
    return rounded


def fetch_allowed_feature_pairs(client: bigquery.Client) -> set:
    """既存 catalog に存在する (feature_type, feature_key) の集合を返す。"""
    query = f"""
        SELECT DISTINCT feature_type, feature_key
        FROM `{CATALOG_FEATURES_TABLE}`
    """
    return {(row.feature_type, row.feature_key) for row in client.query(query).result()}


def fetch_existing_item_qids(client: bigquery.Client, item_qids: List[str]) -> set:
    """dish_category_catalog に実在する item_qid の集合を返す（渡した候補のみ検証）。"""
    if not item_qids:
        return set()
    query = f"""
        SELECT DISTINCT item_qid
        FROM `{CATALOG_TABLE}`
        WHERE item_qid IN UNNEST(@qids)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("qids", "STRING", item_qids)]
    )
    return {row.item_qid for row in client.query(query, job_config=job_config).result()}


def fetch_existing_run_keys(client: bigquery.Client, run_id: str) -> set:
    """指定 run_id で wikidata_food_llm_feature_scores に既に存在する (item_qid, feature_type, feature_key)。"""
    query = f"""
        SELECT DISTINCT item_qid, feature_type, feature_key
        FROM `{SCORES_TABLE}`
        WHERE run_id = @run_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
    )
    return {
        (row.item_qid, row.feature_type, row.feature_key)
        for row in client.query(query, job_config=job_config).result()
    }


def fetch_current_catalog_scores(
    client: bigquery.Client, keys: List[tuple]
) -> Dict[tuple, Dict[str, Any]]:
    """(item_qid, feature_type, feature_key) をキーに、現行 catalog の score/run_id/source を返す。

    google-cloud-bigquery の ArrayQueryParameter は STRUCT 要素型を素の dict では
    受け付けない（400 Invalid value for type: STRUCT<...> is not a valid value）ため、
    item_qid だけを配列パラメータで絞り込み、(feature_type, feature_key) の一致は
    Python側でフィルタする。manual correctionは少数件のバッチが前提のため、
    この程度の絞り込み不足は問題にならない。
    """
    if not keys:
        return {}
    item_qids = sorted({qid for qid, _, _ in keys})
    query = f"""
        SELECT item_qid, feature_type, feature_key, score, source, run_id, updated_at
        FROM `{CATALOG_FEATURES_TABLE}`
        WHERE item_qid IN UNNEST(@qids)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("qids", "STRING", item_qids)]
    )
    wanted = set(keys)
    result: Dict[tuple, Dict[str, Any]] = {}
    for row in client.query(query, job_config=job_config).result():
        key = (row.item_qid, row.feature_type, row.feature_key)
        if key not in wanted:
            continue
        result[key] = {
            "score": row.score,
            "source": row.source,
            "run_id": row.run_id,
            "updated_at": row.updated_at,
        }
    return result


def fetch_dish_labels(client: bigquery.Client, item_qids: List[str]) -> Dict[str, str]:
    """表示用に item_qid -> label_ja を引く（見つからなければ item_qid のまま）。"""
    if not item_qids:
        return {}
    query = f"""
        SELECT item_qid, label_ja
        FROM `{CATALOG_TABLE}`
        WHERE item_qid IN UNNEST(@qids)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("qids", "STRING", item_qids)]
    )
    return {row.item_qid: row.label_ja for row in client.query(query, job_config=job_config).result()}


def validate_corrections(
    raw_rows: List[Dict[str, Any]],
    client: bigquery.Client,
    run_id: str,
    skip_catalog_pair_check: bool = False,
) -> ValidationResult:
    """
    CLI単発入力 / JSONL入力の両方に対して同一のvalidationを適用する。

    issue #1383 のチェックリストに対応:
    - run_id / item_qid / feature_type / feature_key / reason が空でない
    - feature_type/feature_key が既存catalogに存在する（新規featureを弾く）
    - score が 0/0.5/1 のみ（CONTINUOUS_FEATURE_TYPES に限り 0.0〜1.0 の連続値）
    - confidence が high/medium/low のみ
    - reason が120文字以内
    - item_qid が dish_category_catalog に存在する
    - 同一 run 内の (item_qid, feature_type, feature_key) 重複がない
    - 既存の wikidata_food_llm_feature_scores に同一キー・同一run_idが既に無い
    """
    result = ValidationResult()

    if not run_id or not run_id.strip():
        result.errors.append("--run-id must not be empty")
        return result

    if not raw_rows:
        result.errors.append("no correction rows given (use single-row flags or --input-jsonl)")
        return result

    corrections: List[Correction] = []
    seen_in_batch = set()

    for i, raw in enumerate(raw_rows):
        where = f"row[{i}]"
        item_qid = (raw.get("item_qid") or "").strip()
        feature_type = (raw.get("feature_type") or "").strip()
        feature_key = (raw.get("feature_key") or "").strip()
        confidence = (raw.get("confidence") or "").strip()
        reason = (raw.get("reason") or "").strip()
        task = (raw.get("task") or DEFAULT_TASK).strip()

        if not item_qid:
            result.errors.append(f"{where}: item_qid must not be empty")
        elif not re.match(r"^Q\d+$", item_qid):
            result.errors.append(f"{where}: item_qid '{item_qid}' does not look like a Wikidata QID")

        if not feature_type:
            result.errors.append(f"{where}: feature_type must not be empty")
        if not feature_key:
            result.errors.append(f"{where}: feature_key must not be empty")

        score = _coerce_score(raw.get("score"), where, result.errors, feature_type)

        if confidence not in ALLOWED_CONFIDENCE:
            result.errors.append(
                f"{where}: confidence '{confidence}' must be one of {sorted(ALLOWED_CONFIDENCE)}"
            )

        if not reason:
            result.errors.append(f"{where}: reason must not be empty")
        elif len(reason) > REASON_MAX_CHARS:
            result.errors.append(
                f"{where}: reason is {len(reason)} chars, exceeds {REASON_MAX_CHARS} char limit"
            )

        if item_qid and feature_type and feature_key:
            dup_key = (item_qid, feature_type, feature_key)
            if dup_key in seen_in_batch:
                result.errors.append(f"{where}: duplicate key {dup_key} within this input batch")
            seen_in_batch.add(dup_key)

        if score is not None and item_qid and feature_type and feature_key:
            corrections.append(
                Correction(
                    item_qid=item_qid,
                    feature_type=feature_type,
                    feature_key=feature_key,
                    score=score,
                    confidence=confidence,
                    reason=reason,
                    task=task,
                )
            )

    if not result.errors:
        # ここから先はBigQueryへ問い合わせて存在確認する系のチェック
        item_qids = sorted({c.item_qid for c in corrections})
        existing_qids = fetch_existing_item_qids(client, item_qids)
        missing_qids = set(item_qids) - existing_qids
        for qid in sorted(missing_qids):
            result.errors.append(f"item_qid '{qid}' does not exist in dish_category_catalog")

        if not skip_catalog_pair_check:
            allowed_pairs = fetch_allowed_feature_pairs(client)
            for c in corrections:
                if (c.feature_type, c.feature_key) not in allowed_pairs:
                    result.errors.append(
                        f"(feature_type={c.feature_type}, feature_key={c.feature_key}) is not a "
                        "known pair in dish_category_features_catalog. Pass "
                        "--allow-new-feature-key if this is an intentional new feature."
                    )

        existing_run_keys = fetch_existing_run_keys(client, run_id)
        for c in corrections:
            if c.key() in existing_run_keys:
                result.errors.append(
                    f"key {c.key()} already exists in wikidata_food_llm_feature_scores for run_id={run_id}"
                )

    result.corrections = corrections
    return result
