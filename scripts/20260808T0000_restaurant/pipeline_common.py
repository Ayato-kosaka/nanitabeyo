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


def _auth_transient_exc() -> tuple[type[BaseException], ...]:
    """**資格情報の更新が一時的に失敗した**もの。リクエストが相手へ届く前の失敗である。

    #1947 2026-09-22: 5.5 時間の resolve が **開始 22 秒で死んだ**。原因は BigQuery では
    なく WIF の subject token 取得だった:

        google.auth.exceptions.RefreshError: ('Unable to retrieve Identity Pool subject
        token', 'upstream connect error or disconnect/reset before headers.
        reset reason: overflow')

    «外部の一時失敗は再送する» 集合に **資格情報の更新が入っていなかった**。
    2026-09-21 に «横展開の対象は壊れた API 名ではなく外部呼び出し全部» と決めたのに、
    そのときは «BigQuery の呼び出し» までで数え、その下で毎回走る**認証の往復**を
    見ていなかった。トークンは run の途中でも期限切れで更新されるので、
    «起動時だけ» の対策では足りない。

    ⚠️ この集合だけは **冪等でない書き込みでも再送してよい**。トークンの更新は
       リクエストを送る前に走るので、失敗した時点で**相手には何も届いていない**。
    """
    from google.auth.exceptions import RefreshError, TransportError

    return (RefreshError, TransportError)


def _sent_transient_exc() -> tuple[type[BaseException], ...]:
    """**リクエストが相手へ届いたあと**に起きうる一時失敗。

    ⚠️ こちらは «送れてしまった» 可能性があるので、**冪等でない書き込みを再送しては
       いけない**（`_run_job` の ⚠️ を参照。load は行が二重に入り、DML は二度当たる）。
    """
    from google.api_core.exceptions import ServerError, TooManyRequests
    from requests.exceptions import ConnectionError as RequestsConnectionError
    from requests.exceptions import Timeout as RequestsTimeout

    return (ServerError, TooManyRequests, RequestsConnectionError, RequestsTimeout)


# #1947【設計】**再送するかどうかを «HTTP の番号» で決めてはいけない。**
#
# 2026-09-26、11 レーンのうち 1 本（媒体クロール shard 0 / run 1290）が **起動 12 秒で死んだ**。
# 落ちたのは最初のクエリの投入で、返ってきたのは BigQuery の JSON エラーではなく
# Google のフロントエンドの HTML だった:
#
#     Forbidden: 403 POST https://bigquery.googleapis.com/bigquery/v2/projects/food-scroll/jobs
#     <title>Error 403 (Forbidden)!!1</title>
#     Your client does not have permission to get URL /bigquery/v2/projects/food-scroll/jobs
#
# 権限の問題ではない。**同じ 8 秒のあいだに同じ資格情報で投げた run 1289 / 1291 は通っている**。
# つまり «BigQuery へ届く前に、フロントエンドが番号だけ返して弾いた» 一時失敗である。
# それでも `_sent_transient_exc` が 5xx と 429 しか見ていなかったので、即死になった。
#
# ⚠️ **403 を丸ごと再送してはいけない。** 本物の `accessDenied` は待っても直らず、
#    再送すると «155 秒かけて同じ理由で落ちる» だけになって原因が埋まる
#    （実測: 直近 30 日の失敗ジョブに `accessDenied` が 3 件ある）。
#    見分けるのは番号ではなく **BigQuery が理由を付けているか**である。
#    HTML の拒否は `errors == []`、本物は `errors[0]["reason"] == "accessDenied"`。
_RETRYABLE_403_REASONS = frozenset({"rateLimitExceeded", "quotaExceeded"})


def _is_transient_forbidden(exc: BaseException) -> bool:
    """その 403 が «待てば直る» ものか（純関数）。

    - 理由が付いていない → フロントエンドの拒否。**届いていない**ので再送してよい
    - 理由が `rateLimitExceeded` / `quotaExceeded` → 相手が «多すぎる» と言っている。
      429 を再送している以上、同じものを 403 で返されたときだけ殺すのは筋が通らない
    - それ以外（`accessDenied` など） → 恒久エラー。**即座に落とす**
    """
    from google.api_core.exceptions import Forbidden

    if not isinstance(exc, Forbidden):
        return False
    reasons = {e.get("reason") for e in (getattr(exc, "errors", None) or [])
               if isinstance(e, dict)}
    if not reasons:
        return True
    return bool(reasons & _RETRYABLE_403_REASONS)


def _is_auth_transient(exc: BaseException) -> bool:
    """`_auth_transient_exc` の述語版（**届く前**の失敗か）。"""
    return isinstance(exc, _auth_transient_exc())


def _is_sent_transient(exc: BaseException) -> bool:
    """`_sent_transient_exc` の述語版（**届いたあと**にも起きうる一時失敗か）。

    ⚠️ 番号で足すのではなく、ここへ足すこと。403 のように «同じ番号に恒久と一時が
       混ざっている» ものがあり、番号の集合では表せない。
    """
    return isinstance(exc, _sent_transient_exc()) or _is_transient_forbidden(exc)


def _retry_auth_only(fn, *, what: str, attempts: int = 6, base_sleep_s: float = 5.0):
    """**冪等でない呼び出し**を、資格情報の更新の失敗にだけ限って掛け直す。

    `insert_rows_json` のようなストリーミング挿入は再送すると行が二重に入るので、
    «相手へ届く前だと確実に言える» `_auth_transient_exc` だけを拾う。
    """
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: PERF203,BLE001 - 述語で選り分けて掛け直す
            if not _is_auth_transient(e) or i == attempts - 1:
                raise
            wait = base_sleep_s * (2 ** i)
            LOGGER.warning("%s で資格情報の更新が一時失敗（%s）。%.0f 秒待って掛け直します（%d/%d）",
                           what, e, wait, i + 1, attempts)
            time.sleep(wait)


GIB = 1024 ** 3
TIB = 1024 ** 4

# #1947【設計】BigQuery のスキャン課金を «見えない» ままにしない。
#
# 2026-10-01、`5_1` の対象抽出クエリ（1 回 4.58 GiB）が **12 秒おきに 1 日 1,900 回**実行され、
# 2026-09 以降で約 40 TiB（≒$240）を使った。run は全部緑で、**8 日間誰も気づかなかった**。
# 気づけなかった理由は «遅さ» を測って «読んだ量» を測っていなかったことである
# （`5_1` は `BigQuery の待ち時間` を秒で丁寧に出していたが、バイト数は一度も出していない）。
#
# ⚠️ ルールは前から存在した（`.codex/bigquery/safety-policy.md`）。
#   「BigQuery is billable. Ask the user before running a query that dry-runs at 1 GB or more.」
#   **人が守るルールだったので守られなかった。コードの側に置き直す。**
#
# dry run は **課金ゼロ**なので、実行前に必ず見積もれる。見積もりが門より大きければ止める。
# 大きいスキャンが要る処理は «要ることを宣言» する（`allow_scan_gib` か `BQ_ALLOW_SCAN_GIB`）。
SCAN_GATE_GIB = 1.0          # safety-policy.md の «1 GB 以上は確認» をそのまま門にする
USD_PER_TIB = 6.0            # 概算表示専用。**正は請求画面**（リージョンで単価が違う）


def _opt_float(raw: str | None) -> float | None:
    """環境変数を float に。空文字と未設定は «無指定»（None）として扱う。"""
    if raw is None or not str(raw).strip():
        return None
    return float(raw)


def usd_for_bytes(n: int) -> float:
    """スキャン量の概算ドル。表示専用で、請求額の根拠にはしない。"""
    return n / TIB * USD_PER_TIB


def scan_verdict(estimated_bytes: int, *, gate_gib: float, allow_gib: float | None,
                 billed_bytes: int = 0, budget_gib: float | None = None) -> str:
    """このクエリを投げてよいか（純関数）。``"ok"`` / ``"gate"`` / ``"over_budget"``。

    - ``gate``: 見積もりが門（既定 1 GiB）を超え、かつ «要る» と宣言されていない
    - ``over_budget``: この run の累計＋見積もりが予算を超える

    ⚠️ **両方に当たるときは `gate` を先に返す。** «予算が広いから門を通す» を作らない。
    """
    if allow_gib is None or estimated_bytes > allow_gib * GIB:
        if estimated_bytes > gate_gib * GIB:
            return "gate"
    if budget_gib is not None and (billed_bytes + estimated_bytes) > budget_gib * GIB:
        return "over_budget"
    return "ok"


class ScanTooLarge(RuntimeError):
    """見積もりが門を超えたのに «要る» と宣言されていないクエリ。"""


class ScanBudgetExceeded(RuntimeError):
    """この run のスキャン予算（`BQ_MAX_BILLED_GIB`）を超えた。"""


class ScanLedger:
    """この run が «いくら読んだか» を数える。**秒ではなくバイトを数える。**"""

    def __init__(self, gate_gib: float, allow_gib: float | None,
                 budget_gib: float | None) -> None:
        self.gate_gib = gate_gib
        self.allow_gib = allow_gib
        self.budget_gib = budget_gib
        self.billed_bytes = 0
        self.queries = 0
        self.estimated_bytes = 0

    def verdict(self, estimated_bytes: int, allow_gib: float | None) -> str:
        return scan_verdict(estimated_bytes, gate_gib=self.gate_gib,
                            allow_gib=self.allow_gib if allow_gib is None else allow_gib,
                            billed_bytes=self.billed_bytes, budget_gib=self.budget_gib)

    def add(self, billed_bytes: int, estimated_bytes: int = 0) -> None:
        self.billed_bytes += int(billed_bytes or 0)
        self.estimated_bytes += int(estimated_bytes or 0)
        self.queries += 1

    def summary(self) -> str:
        return (f"BigQuery スキャン課金: 累計 {self.billed_bytes / GIB:.2f} GiB"
                f"（≒${usd_for_bytes(self.billed_bytes):.2f}）/ クエリ {self.queries} 本")


class BigQueryPipeline:
    """手動パイプライン向けの小さなBigQueryラッパー。"""

    def __init__(self, config: PipelineConfig | None = None) -> None:
        self.config = config or PipelineConfig()
        # region は Query/Load Job ごとに明示する。Client 自体へ設定すると、
        # google-cloud-bigquery のバージョン差で constructor 引数が変わった際に
        # 全スクリプトが起動不能になるため、安定している project だけを渡す。
        self.client = bigquery.Client(project=self.config.project_id)
        # #1947 スキャン課金の門と台帳。**dispatch 側が «大きいスキャンが要る» を宣言する**。
        #   BQ_ALLOW_SCAN_GIB: このジョブで許す 1 クエリあたりの上限（宣言）
        #   BQ_MAX_BILLED_GIB: この run 全体の予算。超えたら止まる
        self.scans = ScanLedger(
            gate_gib=float(os.getenv("BQ_SCAN_GATE_GIB") or SCAN_GATE_GIB),
            allow_gib=_opt_float(os.getenv("BQ_ALLOW_SCAN_GIB")),
            budget_gib=_opt_float(os.getenv("BQ_MAX_BILLED_GIB")),
        )

    @property
    def dataset_ref(self) -> str:
        return self.config.dataset_ref

    def table(self, table_name: str) -> str:
        if not _SAFE_IDENTIFIER.fullmatch(table_name):
            raise ValueError(f"不正なBigQueryテーブル名です: {table_name!r}")
        return f"{self.dataset_ref}.{table_name}"

    # #1947【設計】BigQuery 側の一時障害（5xx / 429 / 接続断）で **長時間ジョブを殺さない**。
    #
    # 2026-09-21、5.5 時間の収集ラウンドが開始 137 分で落ちた。原因は収集そのものではなく、
    # 途中の flush が `load_json_rows` → `job.result()` で踏んだ
    # `InternalServerError: 500 GET .../jobs/<id>`（**ジョブの結果を聞きに行く GET**）だった。
    # 相手側の一時障害で、こちらは 285/6000 アカメントまでしか進めず 2.7 時間を捨てた。
    # これは前日 IG API で直したもの（`4_2` の `TransientExhausted`）と**同じ形**で、
    # あのときは IG の呼び出しだけを見て BigQuery の呼び出しを見ていなかった。
    #
    # ⚠️ **一時エラーでジョブを投げ直さないこと。** polling の 500 は «ジョブが失敗した» では
    #    なく «結果を聞けなかった» である。投げ直すと load は同じ行を二重に入れ、DML は
    #    同じ更新を二度当てる。**投げ直してよいのは «まだジョブが出来ていない» ときだけ**な
    #    ので、ここでは job を握ったまま `result()` を掛け直す。
    def _run_job(self, submit, *, what: str, attempts: int = 6, base_sleep_s: float = 5.0):
        """ジョブを投げて完走させ、``(job, job.result() の戻り)`` を返す。

        Args:
            submit: ジョブを作って返す callable（``client.query`` / ``load_table_from_file``）。
                **一時エラーのたびに呼ばれるわけではない**（上の ⚠️ を参照）。
            what: ログに出す «何をしていたか»。
        """
        job = None
        for i in range(attempts):
            try:
                if job is None:
                    job = submit()
                return job, job.result()
            except Exception as e:  # noqa: PERF203,BLE001 - 述語で選り分けて掛け直す
                if not (_is_auth_transient(e) or _is_sent_transient(e)) or i == attempts - 1:
                    raise
                wait = base_sleep_s * (2 ** i)
                LOGGER.warning(
                    "BigQuery の一時エラー（%s）。%.0fs 待って%sします（%d/%d）: %s",
                    what, wait,
                    "同じジョブを見に行き直" if job is not None else "投げ直",
                    i + 1, attempts - 1, e)
                time.sleep(wait)

    def _run_call(self, fn, *, what: str, attempts: int = 6, base_sleep_s: float = 5.0):
        """**冪等な**呼び出し（読み取り）を、一時エラーで掛け直す。

        `_run_job` はジョブを握って `result()` を掛け直す形なので、`get_table` のような
        «ジョブにならない» 呼び出しには使えない。読み取りは何度やっても同じなので、
        届く前（`_auth_transient_exc`）も届いたあと（`_sent_transient_exc`）も拾ってよい。

        ⚠️ **書き込みには使わないこと。** 冪等でない書き込みは `_retry_auth_only`。
        """
        for i in range(attempts):
            try:
                return fn()
            except Exception as e:  # noqa: PERF203,BLE001 - 述語で選り分けて掛け直す
                if not (_is_auth_transient(e) or _is_sent_transient(e)) or i == attempts - 1:
                    raise
                wait = base_sleep_s * (2 ** i)
                LOGGER.warning("%s の一時エラー（%s）。%.0f 秒待って掛け直します（%d/%d）",
                               what, e, wait, i + 1, attempts)
                time.sleep(wait)

    def get_table(self, table_id: str, **kwargs):
        """`client.get_table` の一時エラーを飲み込む入口。読み取りなので冪等。

        ⚠️ **`pipeline.client.get_table` を直に呼ばないこと。** 資格情報の更新の
           一時失敗（#1947）で長時間ジョブが死ぬ。回帰テストが直呼びを禁止している。
        """
        return self._run_call(lambda: self.client.get_table(table_id, **kwargs),
                              what=f"get_table {table_id}")

    def insert_rows_json(self, table_id: str, rows, **kwargs):
        """`client.insert_rows_json` の入口。**冪等でない**ので認証の失敗だけ掛け直す。

        ⚠️ **`pipeline.client.insert_rows_json` を直に呼ばないこと。** 素で呼ぶと
           資格情報の更新の一時失敗で死に、雑に再送すると行が二重に入る（#1947）。

        ⚠️ **`**kwargs` を素通しすること。** 2026-09-22、直呼びを入口へ寄せたときに
           引数を `(table_id, rows)` だけにしてしまい、`row_ids=` を渡している
           `pg_sync_common.write_sync_log` が TypeError で落ちた
           （dev 同期が最後のログ書き込みだけで失敗した）。**入口は呼び出し側の
           シグネチャを狭めてはいけない。**
        """
        return _retry_auth_only(
            lambda: self.client.insert_rows_json(table_id, rows, **kwargs),
            what=f"insert_rows_json {table_id}")

    def dry_run_bytes(self, sql: str,
                      parameters: list[bigquery.ScalarQueryParameter] | None = None) -> int:
        """このクエリが読むバイト数の見積もり。**dry run は課金ゼロ**なので必ず先に通す。"""
        cfg = bigquery.QueryJobConfig(query_parameters=parameters or [],
                                      dry_run=True, use_query_cache=False)
        # ⚠️ #1947 **dry run も «外部呼び出し» である。** ここを素で呼んでいたのを
        #   既存の回帰テスト（test_bq_transient_does_not_kill_run）が見つけた。
        #   見積もりの 1 回の 5xx で 5.5 時間の run が死ぬのは、このリポジトリが
        #   2 度踏んだ形そのもの（`_run_job` の設計コメント）。必ず通す。
        #   dry run は job を «作るだけ» で result() を持たないので、submit だけ掛け直す。
        job, _ = self._run_job(
            lambda: self.client.query(sql, job_config=cfg, location=self.config.region),
            what="dry run（見積もり・課金ゼロ）")
        return int(job.total_bytes_processed or 0)

    def _query(self, sql: str, parameters, *, what: str, allow_scan_gib: float | None):
        """**すべてのクエリが通る 1 箇所。** 見積もり → 門 → 実行 → 台帳。

        #1947 ここを «1 箇所» にしておくのが要点である。6 つの script が
        `client.query` を写経していたころ、一時障害の扱いが script ごとに違っていた
        （`_run_job` の設計コメント）。費用も同じで、**入口が分かれていると片方だけ守られる**。
        """
        est = self.dry_run_bytes(sql, parameters)
        verdict = self.scans.verdict(est, allow_scan_gib)
        if verdict == "gate":
            raise ScanTooLarge(
                f"このクエリは dry run で {est / GIB:.2f} GiB"
                f"（≒${usd_for_bytes(est):.2f}）読みます。"
                f"門は {self.scans.gate_gib:.2f} GiB です（`.codex/bigquery/safety-policy.md`:"
                f" «Ask the user before running a query that dry-runs at 1 GB or more»）。\n"
                f"2026-10-01、この門が無かったために 4.58 GiB のクエリが 1 日 1,900 回走り、"
                f"約 40 TiB（≒$240）を使いました。\n"
                f"→ 読む量を減らせないか先に見てください（判定に要らない大きな列を外す／"
                f"パーティション列 `fetched_at` で区切る）。\n"
                f"→ 本当に要るなら、**オーナーの承認を得てから** dispatch で "
                f"`BQ_ALLOW_SCAN_GIB` を宣言してください（この run の 1 クエリ上限）。\n"
                f"SQL の先頭: {' '.join(sql.split())[:160]}")
        if verdict == "over_budget":
            raise ScanBudgetExceeded(
                f"この run のスキャン予算 {self.scans.budget_gib:.1f} GiB を超えます"
                f"（累計 {self.scans.billed_bytes / GIB:.2f} GiB ＋ 見積もり {est / GIB:.2f} GiB）。"
                f"止めます。{self.scans.summary()}")
        job_config = bigquery.QueryJobConfig(query_parameters=parameters or [])
        job, result = self._run_job(
            lambda: self.client.query(sql, job_config=job_config,
                                      location=self.config.region),
            what=what)
        billed = int(getattr(job, "total_bytes_billed", 0) or 0)
        self.scans.add(billed, est)
        # ⚠️ **毎本出す。** «たまに出す» と、ループの中の 1 本が見えなくなる（今回の原因）。
        LOGGER.info("BQ %s: %.3f GiB 課金（≒$%.3f）| %s",
                    what, billed / GIB, usd_for_bytes(billed), self.scans.summary())
        return job, result

    def execute(
        self, sql: str, parameters: list[bigquery.ScalarQueryParameter] | None = None,
        *, allow_scan_gib: float | None = None,
    ) -> Any:
        _, result = self._query(sql, parameters, what="query", allow_scan_gib=allow_scan_gib)
        return result

    def execute_dml(
        self, sql: str, parameters: list[bigquery.ScalarQueryParameter] | None = None,
        *, what: str = "DML", allow_scan_gib: float | None = None,
    ) -> int:
        """UPDATE/DELETE/MERGE を実行し、**影響行数**を返す。

        #1947 これを置くまで、6 つの script が «query して job.result() して
        `num_dml_affected_rows` を読む» 同じ 8 行を写経しており、**そのどれもが
        BigQuery の一時的な 5xx で落ちる**状態だった（`_run_job` の設計コメント参照）。
        影響行数が要るときは `execute` ではなくこちらを使う。
        """
        job, _ = self._query(sql, parameters, what=what, allow_scan_gib=allow_scan_gib)
        return int(job.num_dml_affected_rows or 0)

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
                # ⚠️ #1947 **影響行数を返すこと。** 後埋め系はここの戻り値でしか
                #   «書けたのか / 1 行も当たらなかったのか» を知れない。rows を返していた
                #   ころ、呼び出し側は «投げた件数» を完了件数として出していた。
                return self.execute_dml(sql, parameters, what="DML（同時更新の再試行つき）")
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
        allow_scan_gib: float | None = None,
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

        # #1947 DELETE も読んだぶんだけ課金される。**門と台帳を通す 1 箇所へ寄せる。**
        #   この経路は «門を通らずに query している» とテストが指摘して見つかった。
        job, _ = self._query(
            f"DELETE FROM `{table_id}` WHERE {where}", parameters,
            what=f"DELETE {table_name}", allow_scan_gib=allow_scan_gib)
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
            job, _ = self._run_job(
                lambda: self._submit_load(temporary_path, table_name, job_config),
                what=f"load {table_name}")
            if int(job.output_rows or 0) != count:
                raise RuntimeError(
                    f"Load Job件数不一致: input={count}, output={job.output_rows}, table={table_name}"
                )
            return count
        finally:
            temporary_path.unlink(missing_ok=True)

    def _submit_load(self, path: Path, table_name: str, job_config) -> Any:
        """ファイルを開いて Load Job を作って返す（投げるだけ。完走は `_run_job` が見る）。"""
        with path.open("rb") as stream:
            return self.client.load_table_from_file(
                stream,
                self.table(table_name),
                job_config=job_config,
                location=self.config.region,
            )

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
        job, _ = self._run_job(
            lambda: self._submit_load(path, table_name, job_config),
            what=f"load {table_name}")
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
        job_config.schema = self.get_table(self.table(table_name)).schema
        job, _ = self._run_job(
            lambda: self._submit_load(path, table_name, job_config),
            what=f"load {table_name}")
        return int(job.output_rows or 0)

    def append_manifest(self, row: Mapping[str, Any]) -> None:
        errors = self.insert_rows_json(
            self.table("restaurant_source_manifests"), [dict(row)])
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
                # #1947 **費用を durable な記録に残す。** 2026-10-01 まで、run のログにも
                #   この表にも «読んだバイト数» がどこにも無く、8 日間気づけなかった。
                #   `finally` で畳むので、ここに入るのは **run が実際に読んだ合計**である。
                "parameters_json": json.dumps(
                    {**(parameters or {}),
                     "bq_scan_billed_gib": round(self.scans.billed_bytes / GIB, 3),
                     "bq_scan_usd_est": round(usd_for_bytes(self.scans.billed_bytes), 3),
                     "bq_queries": self.scans.queries},
                    ensure_ascii=False, default=json_default
                ),
                "row_count": result["row_count"],
                "error_message": error_message,
                "started_at": started_at.isoformat(),
                "finished_at": utc_now().isoformat(),
            }
            LOGGER.info("%s（step %s・%s）", self.scans.summary(), step_name, status)
            errors = self.insert_rows_json(
                self.table("restaurant_pipeline_runs"), [row])
            if errors:
                LOGGER.error("pipeline runログの記録に失敗しました: %s", errors)


def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
