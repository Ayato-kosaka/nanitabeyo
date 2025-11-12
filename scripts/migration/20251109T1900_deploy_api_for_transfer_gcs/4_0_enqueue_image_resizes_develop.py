#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PostgreSQL から対象レコードを取得し、Cloud Tasks の HTTP ターゲットで
Cloud Run エンドポイントを一括キックするスクリプト。

■ 本スクリプトの特徴
- 設定は 4_0_gcp_config_develop.yaml に集約（環境変数は最小化）
- PostgreSQL の URL は実行時引数で渡す（PCに保存しない）
- 指定の 4 区分（dish_media, restaurants, users）を一括投入
- ペイロードは依頼仕様どおり:
  { table, column, recordId, size, originalPath, aspectRatio? }

■ 事前要件
- Cloud Tasks API 有効化
- OIDC 署名に使う SA に Cloud Run サービスへの run.invoker 付与
- 実行環境の認証: GOOGLE_APPLICATION_CREDENTIALS で SA JSON を指すか、
  `gcloud auth application-default login` により ADC を満たすこと
  （環境に残したくない場合は、実行コマンドの先頭にだけ一時的に指定がおすすめ）

■ 使い方（例）
  # 1) Python パッケージのインストール（仮想環境推奨）
  pip install google-cloud-tasks psycopg[binary] PyYAML

  # 2) 認証ファイルをこの実行だけに適用
  GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  python 4_0_enqueue_image_resizes_develop.py \
    --pg-url "postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require" \
    --config ./4_0_gcp_config_develop.yaml

  # Dry-run（Cloud Tasks を作成せずに出力だけ確認）
  python 4_0_enqueue_image_resizes_develop.py --pg-url "..." --config ./4_0_gcp_config_develop.yaml --dry-run

"""

import argparse
import json
import sys
import time
from typing import Iterable, List, Optional, Tuple

import yaml
import psycopg
from google.cloud import tasks_v2
from google.api_core.exceptions import GoogleAPICallError, RetryError

# =========================
# クエリ定義（依頼どおり）
# =========================
# dish_media.media_path のリサイズ（画像のみ）
SQL_DISH_MEDIA_IMAGE = """
SELECT id AS recordId, media_path AS originalPath
FROM dev.dish_media
WHERE media_type = 'image';
"""

# dish_media.thumbnail_path のリサイズ（null/空はスキップ推奨）
SQL_DISH_MEDIA_THUMB = """
SELECT id AS recordId, thumbnail_path AS originalPath
FROM dev.dish_media;
"""

# restaurants.image_path のリサイズ（2サイズ）
SQL_RESTAURANTS_IMAGE = """
SELECT id AS recordId, image_path AS originalPath
FROM dev.restaurants;
"""

# users.avatar_path のリサイズ（2サイズ、null は除外）
SQL_USERS_AVATAR = """
SELECT id AS recordId, avatar_path AS originalPath
FROM dev.users
WHERE avatar_path IS NOT NULL;
"""


def iter_rows(conn, sql: str, batch_size: int) -> Iterable[List[Tuple]]:
    """
    大量データを扱うため、サーバーサイドカーソルでバッチ取得。
    """
    with conn.cursor(name="image_resize_cursor") as cur:
        cur.execute(sql)
        while True:
            rows = cur.fetchmany(batch_size)
            if not rows:
                break
            yield rows


def build_payload(table: str, column: str, record_id, size: int, original_path, aspect_ratio: Optional[float] = None) -> dict:
    """
    Cloud Run に渡す JSON ペイロードを構築。
    仕様: { table, column, recordId, size, originalPath, aspectRatio? }
    """
    payload = {
        "table": table,
        "column": column,
        "recordId": record_id,
        "size": size,
        "originalPath": original_path,
    }
    if aspect_ratio is not None:
        payload["aspectRatio"] = aspect_ratio
    return payload


def should_skip_path(original_path: Optional[str], skip_empty: bool) -> bool:
    if not skip_empty:
        return False
    if original_path is None:
        return True
    if isinstance(original_path, str) and original_path.strip() == "":
        return True
    return False


def create_task(
    client: tasks_v2.CloudTasksClient,
    parent: str,
    run_url: str,
    headers: dict,
    method: str,
    sa_email: str,
    audience: str,
    body: dict,
    max_retries: int,
    backoff_ms: int,
    dry_run: bool,
) -> Optional[str]:
    """
    Cloud Tasks の HTTP タスクを作成。
    失敗時はリトライ。dry_run=True の場合は作成せずにログ出力。
    戻り値: 作成されたタスク名 or None（dry_run）
    """
    http_method = getattr(tasks_v2.HttpMethod, method.upper(), None)
    if http_method is None:
        raise ValueError(f"Unsupported HTTP method: {method}")

    task = {
        "http_request": {
            "http_method": http_method,
            "url": run_url,
            "headers": headers,
            "body": json.dumps(body).encode("utf-8"),
            "oidc_token": {
                "service_account_email": sa_email,
                "audience": audience,
            },
        }
    }

    if dry_run:
        print(f"[DRY-RUN] would create task with body={json.dumps(body, ensure_ascii=False)}")
        return None

    attempt = 0
    while True:
        try:
            resp = client.create_task(parent=parent, task=task)
            return resp.name
        except (GoogleAPICallError, RetryError) as e:
            attempt += 1
            if attempt > max_retries:
                print(f"[ERROR] create_task failed after {attempt} attempts: {e}", file=sys.stderr)
                raise
            sleep_sec = (backoff_ms / 1000.0) * (2 ** (attempt - 1))
            print(f"[WARN] create_task failed (attempt={attempt}): {e} -> retry in {sleep_sec:.2f}s")
            time.sleep(sleep_sec)


def main():
    parser = argparse.ArgumentParser(description="Bulk enqueue image resize tasks via Cloud Tasks")
    parser.add_argument("--pg-url", required=True, help="PostgreSQL の接続 URL（例: postgresql://user:pass@host:5432/db?sslmode=require）")
    parser.add_argument("--config", default="./4_0_gcp_config_develop.yaml", help="設定ファイル（YAML）のパス")
    parser.add_argument("--dry-run", action="store_true", help="Cloud Tasks を作成せず、内容だけ出力する")
    args = parser.parse_args()

    # 設定ファイル読み込み（YAML）
    with open(args.config, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    project_id = cfg["project_id"]
    location = cfg["location"]
    queue = cfg["queue"]
    run_url = cfg["run_url"]
    sa_email = cfg["oidc_service_account_email"]
    audience = cfg["oidc_audience"]
    method = cfg.get("http_method", "POST")
    headers = cfg.get("headers", {"Content-Type": "application/json"})

    batch_size = int(cfg.get("batch_size", 100))
    sleep_interval_ms = int(cfg.get("sleep_interval_ms", 10))
    max_retries_per_task = int(cfg.get("max_retries_per_task", 3))
    retry_backoff_ms = int(cfg.get("retry_backoff_ms", 200))
    skip_empty_paths = bool(cfg.get("skip_empty_paths", True))

    dry_run = args.dry_run or bool(cfg.get("dry_run", False))

    # 共通アスペクト比（9:16）
    ASPECT_9_16 = 9 / 16

    # Cloud Tasks クライアント初期化
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project_id, location, queue)

    # DB 接続（psycopg v3）
    # autocommit=True で読み取り主体のためトランザクション簡略化
    print("[INFO] connecting to PostgreSQL...")
    with psycopg.connect(args.pg_url, autocommit=True) as conn:
        print("[INFO] connected. starting enqueue...")

        total_created = 0

        # ------------------------------------
        # 1) dish_media.media_path -> size 1024, aspectRatio 9/16
        # ------------------------------------
        for rows in iter_rows(conn, SQL_DISH_MEDIA_IMAGE, batch_size):
            for record_id, original_path in rows:
                if should_skip_path(original_path, skip_empty_paths):
                    continue
                body = build_payload(
                    table="dish_media",
                    column="media_path",
                    record_id=record_id,
                    size=1024,
                    original_path=original_path,
                    aspect_ratio=ASPECT_9_16,
                )
                name = create_task(
                    client,
                    parent,
                    run_url,
                    headers,
                    method,
                    sa_email,
                    audience,
                    body,
                    max_retries_per_task,
                    retry_backoff_ms,
                    dry_run,
                )
                total_created += 0 if name is None else 1
                time.sleep(sleep_interval_ms / 1000.0)

        # ------------------------------------
        # 2) dish_media.thumbnail_path -> size 256, aspectRatio 9/16
        # ------------------------------------
        for rows in iter_rows(conn, SQL_DISH_MEDIA_THUMB, batch_size):
            for record_id, original_path in rows:
                if should_skip_path(original_path, skip_empty_paths):
                    continue
                body = build_payload(
                    table="dish_media",
                    column="thumbnail_path",
                    record_id=record_id,
                    size=256,
                    original_path=original_path,
                    aspect_ratio=ASPECT_9_16,
                )
                name = create_task(
                    client,
                    parent,
                    run_url,
                    headers,
                    method,
                    sa_email,
                    audience,
                    body,
                    max_retries_per_task,
                    retry_backoff_ms,
                    dry_run,
                )
                total_created += 0 if name is None else 1
                time.sleep(sleep_interval_ms / 1000.0)

        # ------------------------------------
        # 3) restaurants.image_path -> size 256 と 64, aspectRatio 9/16
        # ------------------------------------
        for rows in iter_rows(conn, SQL_RESTAURANTS_IMAGE, batch_size):
            for record_id, original_path in rows:
                if should_skip_path(original_path, skip_empty_paths):
                    continue
                for size in (256, 64):
                    body = build_payload(
                        table="restaurants",
                        column="image_path",
                        record_id=record_id,
                        size=size,
                        original_path=original_path,
                        aspect_ratio=ASPECT_9_16,
                    )
                    name = create_task(
                        client,
                        parent,
                        run_url,
                        headers,
                        method,
                        sa_email,
                        audience,
                        body,
                        max_retries_per_task,
                        retry_backoff_ms,
                        dry_run,
                    )
                    total_created += 0 if name is None else 1
                    time.sleep(sleep_interval_ms / 1000.0)

        # ------------------------------------
        # 4) users.avatar_path -> size 256 と 64（null はクエリ側で除外）※ aspectRatio は未指定
        # ------------------------------------
        for rows in iter_rows(conn, SQL_USERS_AVATAR, batch_size):
            for record_id, original_path in rows:
                if should_skip_path(original_path, skip_empty_paths):
                    continue
                for size in (256, 64):
                    body = build_payload(
                        table="users",
                        column="avatar_path",
                        record_id=record_id,
                        size=size,
                        original_path=original_path,
                        # aspect_ratio は None のまま（キーを送らない）
                    )
                    name = create_task(
                        client,
                        parent,
                        run_url,
                        headers,
                        method,
                        sa_email,
                        audience,
                        body,
                        max_retries_per_task,
                        retry_backoff_ms,
                        dry_run,
                    )
                    total_created += 0 if name is None else 1
                    time.sleep(sleep_interval_ms / 1000.0)

        print(f"[INFO] done. tasks created: {total_created}")
    print("[INFO] finished.")


if __name__ == "__main__":
    main()
