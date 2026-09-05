"""店提案用の番号付きスクリプトで共有する BigQuery 基盤。

このモジュールは業務上の名寄せルールを持たない。Dataset、run_id、Load Job、
実行ログなど、全ステップで同じにすべき機械的な処理だけを集約する。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import time
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from google.cloud import bigquery

LOGGER = logging.getLogger(__name__)

GCP_PROJECT = os.getenv("GCP_PROJECT", "food-scroll")
BQ_DATASET = os.getenv("BQ_DATASET", "restaurant_recommendation")
BQ_REGION = os.getenv("BQ_REGION", "asia-northeast1")
DISH_CATEGORY_DATASET = os.getenv("DISH_CATEGORY_DATASET", "wikidata_food_graph")

_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def json_default(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"JSONへ変換できない型です: {type(value)!r}")


def require_run_id(value: str | None = None) -> str:
    """複数の手動ステップを同じ入力snapshotとして結ぶ run_id を返す。

    自動オーケストレーターを置かない初期版では、オペレーターが最初に
    RESTAURANT_PIPELINE_RUN_ID をexportし、全スクリプトで同じ値を使う。
    暗黙に毎回別IDを生成すると、OvertureとIFASが別snapshotとして扱われるため
    環境変数または引数を必須にしている。
    """

    run_id = value or os.getenv("RESTAURANT_PIPELINE_RUN_ID")
    if not run_id:
        raise ValueError(
            "run_id がありません。RESTAURANT_PIPELINE_RUN_ID を設定するか --run-id を指定してください。"
        )
    if not _SAFE_RUN_ID.fullmatch(run_id):
        raise ValueError(
            "run_id は英数字、'.'、'_'、':'、'-' の128文字以内にしてください。"
        )
    return run_id


def current_git_revision(repo_root: Path) -> str | None:
    """監査ログ用のcommit SHAを取得する。git外での実行は失敗扱いにしない。"""

    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def stable_record_hash(payload: Mapping[str, Any]) -> str:
    """辞書順に依存しないsource recordの差分検知用hash。"""

    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=json_default,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class PipelineConfig:
    project_id: str = GCP_PROJECT
    dataset_id: str = BQ_DATASET
    region: str = BQ_REGION

    @property
    def dataset_ref(self) -> str:
        return f"{self.project_id}.{self.dataset_id}"

    @property
    def dish_dataset_ref(self) -> str:
        return f"{self.project_id}.{DISH_CATEGORY_DATASET}"


class BigQueryPipeline:
    """手動パイプライン向けの小さなBigQueryラッパー。"""

    def __init__(self, config: PipelineConfig | None = None) -> None:
        self.config = config or PipelineConfig()
        # region は Query/Load Job ごとに明示する。Client 自体へ設定すると、
        # google-cloud-bigquery のバージョン差で constructor 引数が変わった際に
        # 全スクリプトが起動不能になるため、安定している project だけを渡す。
        self.client = bigquery.Client(project=self.config.project_id)

    @property
    def dataset_ref(self) -> str:
        return self.config.dataset_ref

    def table(self, table_name: str) -> str:
        if not _SAFE_IDENTIFIER.fullmatch(table_name):
            raise ValueError(f"不正なBigQueryテーブル名です: {table_name!r}")
        return f"{self.dataset_ref}.{table_name}"

    def execute(
        self, sql: str, parameters: list[bigquery.ScalarQueryParameter] | None = None
    ) -> Any:
        job_config = bigquery.QueryJobConfig(query_parameters=parameters or [])
        job = self.client.query(sql, job_config=job_config, location=self.config.region)
        return job.result()

    def execute_dml_retrying(
        self, sql: str, parameters: list[bigquery.ScalarQueryParameter] | None = None,
        *, attempts: int = 6, base_sleep_s: float = 5.0,
    ) -> Any:
        """UPDATE/DELETE を «同時更新でシリアライズできない» 400 に耐えて実行する。

        BigQuery は同じテーブルへの DML を同時に走らせると、片方を
        `Could not serialize access to table ... due to concurrent update` で落とす。
        後埋め系（4_11 / 4_13）は sns_post_raw を run 単位で並列に更新し、その裏で
        収集ジョブが同じテーブルへ append しているので、これは通常運転で起きる。
        実際に 4_13 が 1 チャンク目で落ちた。指数バックオフで待って掛け直す。
        """
        from google.api_core.exceptions import BadRequest

        for i in range(attempts):
            try:
                return self.execute(sql, parameters)
            except BadRequest as e:  # noqa: PERF203 - リトライ対象を message で見分ける
                if "serialize access" not in str(e) or i == attempts - 1:
                    raise
                wait = base_sleep_s * (2 ** i)
                LOGGER.warning("同時更新で弾かれました。%.0fs 待って再試行します（%d/%d）",
                               wait, i + 1, attempts - 1)
                time.sleep(wait)

    def execute_sql_file(self, path: Path) -> None:
        sql = path.read_text(encoding="utf-8").replace("${DATASET}", self.dataset_ref)
        self.execute(sql)

    def delete_run_rows(
        self,
        table_name: str,
        run_id: str,
        *,
        partition_field: str | None = None,
        partition_date: date | None = None,
    ) -> int:
        """同じrun_idの途中再実行を冪等にする。

        rawはsnapshot間ではappend-onlyだが、同一run_idの失敗再開で重複を作らないため、
        対象runだけ削除してからLoad Jobをやり直す。
        """

        if (partition_field is None) != (partition_date is None):
            raise ValueError(
                "partition_field と partition_date は両方指定してください。"
            )
        if partition_field and not _SAFE_IDENTIFIER.fullmatch(partition_field):
            raise ValueError(f"不正なpartition fieldです: {partition_field!r}")

        table_id = self.table(table_name)
        where = "run_id = @run_id"
        parameters = [bigquery.ScalarQueryParameter("run_id", "STRING", run_id)]
        if partition_field and partition_date:
            # require_partition_filter=TRUE のraw/log tableでは、run_idだけのDELETEは
            # BigQueryに拒否される。同じsnapshot partitionも必ず絞る。
            where += f" AND {partition_field} = @partition_date"
            parameters.append(
                bigquery.ScalarQueryParameter("partition_date", "DATE", partition_date)
            )

        job_config = bigquery.QueryJobConfig(query_parameters=parameters)
        job = self.client.query(
            f"DELETE FROM `{table_id}` WHERE {where}",
            job_config=job_config,
            location=self.config.region,
        )
        job.result()
        return int(job.num_dml_affected_rows or 0)

    def load_json_rows(
        self,
        table_name: str,
        rows: Iterable[Mapping[str, Any]],
        *,
        write_disposition: str = bigquery.WriteDisposition.WRITE_APPEND,
    ) -> int:
        """Iterableを一度巨大なlistにせず、NDJSON Load Jobで投入する。"""

        count = 0
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ndjson", encoding="utf-8", delete=False
        ) as stream:
            temporary_path = Path(stream.name)
            for row in rows:
                stream.write(
                    json.dumps(
                        row,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        default=json_default,
                    )
                    + "\n"
                )
                count += 1

        try:
            if count == 0:
                raise ValueError(
                    f"{table_name} へ投入する行が0件です。空Load Jobは実行しません。"
                )
            job_config = bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=write_disposition,
            )
            with temporary_path.open("rb") as stream:
                job = self.client.load_table_from_file(
                    stream,
                    self.table(table_name),
                    job_config=job_config,
                    location=self.config.region,
                )
            job.result()
            if int(job.output_rows or 0) != count:
                raise RuntimeError(
                    f"Load Job件数不一致: input={count}, output={job.output_rows}, table={table_name}"
                )
            return count
        finally:
            temporary_path.unlink(missing_ok=True)

    def load_ndjson_file(
        self,
        table_name: str,
        path: Path,
        *,
        write_disposition: str = bigquery.WriteDisposition.WRITE_APPEND,
    ) -> int:
        """既にストリーミング生成したNDJSONをLoad Jobで投入する。

        OSMのようなcallback型parserはIterableへ変換すると全件をメモリに持ちやすい。
        そのため、parserが一時ファイルへ順次書き、このメソッドで一括Loadする。
        """

        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=write_disposition,
        )
        with path.open("rb") as stream:
            job = self.client.load_table_from_file(
                stream,
                self.table(table_name),
                job_config=job_config,
                location=self.config.region,
            )
        job.result()
        return int(job.output_rows or 0)

    def load_parquet(
        self,
        table_name: str,
        path: Path,
        *,
        write_disposition: str = bigquery.WriteDisposition.WRITE_APPEND,
    ) -> int:
        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.PARQUET,
            write_disposition=write_disposition,
        )
        # これが無いと parquet の LIST 型が RECORD（list.element の入れ子）として
        # 解釈され、ARRAY<STRING> 列への load が schema mismatch で落ちる
        # （実際に categories 列で落ちた）。
        parquet_options = bigquery.ParquetOptions()
        parquet_options.enable_list_inference = True
        job_config.parquet_options = parquet_options
        # duckdb の COPY は全列を optional で書くため、スキーマ推定に任せると
        # REQUIRED 列が "changed mode from REQUIRED to NULLABLE" で落ちる。
        # 宛先テーブルのスキーマを明示して推定を使わせない（NULL が実際に
        # 入っていればこの指定でも load 時に落ちる。それは落ちるべきである）。
        job_config.schema = self.client.get_table(self.table(table_name)).schema
        with path.open("rb") as stream:
            job = self.client.load_table_from_file(
                stream,
                self.table(table_name),
                job_config=job_config,
                location=self.config.region,
            )
        job.result()
        return int(job.output_rows or 0)

    def append_manifest(self, row: Mapping[str, Any]) -> None:
        errors = self.client.insert_rows_json(
            self.table("restaurant_source_manifests"), [dict(row)]
        )
        if errors:
            raise RuntimeError(f"source manifestの記録に失敗しました: {errors}")

    @contextmanager
    def step(
        self,
        run_id: str,
        step_name: str,
        *,
        parameters: Mapping[str, Any] | None = None,
        repo_root: Path | None = None,
    ) -> Iterator[dict[str, int | None]]:
        """処理結果を必ず pipeline_runs へ残すcontext manager。"""

        started_at = utc_now()
        result: dict[str, int | None] = {"row_count": None}
        status = "succeeded"
        error_message: str | None = None
        try:
            yield result
        except Exception as error:
            status = "failed"
            error_message = str(error)[:16_000]
            raise
        finally:
            row = {
                "run_id": run_id,
                "step_name": step_name,
                "status": status,
                "code_version": current_git_revision(repo_root) if repo_root else None,
                "parameters_json": json.dumps(
                    parameters or {}, ensure_ascii=False, default=json_default
                ),
                "row_count": result["row_count"],
                "error_message": error_message,
                "started_at": started_at.isoformat(),
                "finished_at": utc_now().isoformat(),
            }
            errors = self.client.insert_rows_json(
                self.table("restaurant_pipeline_runs"), [row]
            )
            if errors:
                LOGGER.error("pipeline runログの記録に失敗しました: %s", errors)


def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
