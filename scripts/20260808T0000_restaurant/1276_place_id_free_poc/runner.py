#!/usr/bin/env python3
"""Google への問い合わせ実行と、その結果の永続キャッシュ。

判定ルールを何度も作り直すため、APIの生結果（place_idの並び）を SQLite に貯めて
おき、ルール変更のたびに再問い合わせしないようにする。無料SKUとはいえ、同じ
クエリを何万回も投げ直すのは Google 側への負荷であり、実験の再現性も落ちる。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from free_places import FreePlacesClient, SearchResult

SCHEMA = """
CREATE TABLE IF NOT EXISTS probe (
  seed_id     TEXT NOT NULL,
  probe       TEXT NOT NULL,
  fingerprint TEXT NOT NULL DEFAULT '',
  status      INTEGER,
  ids         TEXT NOT NULL,
  error       TEXT,
  PRIMARY KEY (seed_id, probe)
);
"""


@dataclass(frozen=True)
class ProbeSpec:
    """1回のAPI呼び出しの指定。"""

    seed_id: str
    probe: str
    kind: str  # "text" | "nearby"
    body: dict[str, Any]

    @property
    def fingerprint(self) -> str:
        """リクエスト本文の指紋。

        キャッシュを (seed_id, probe) だけで引くと、住所クエリの作り方や pageSize を
        変えたときに古い結果を無言で再利用してしまい、測定が別条件の混ざり物になる。
        本文が変わったら別物として引き直すため、本文そのものを鍵に含める。
        """

        canonical = json.dumps(self.body, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


class ProbeCache:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(path), check_same_thread=False)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.executescript(SCHEMA)
        self._migrate()
        self._connection.commit()
        self._lock = threading.Lock()

    def _migrate(self) -> None:
        """既存キャッシュに不足している列を足す。

        ``CREATE TABLE IF NOT EXISTS`` は列を追加しないため、fingerprint 導入前の
        キャッシュを開くと読み出しで落ちる。中断・再開できることが売りの仕組みなので、
        古いキャッシュもそのまま開けるようにしておく。
        """

        columns = {row[1] for row in self._connection.execute("PRAGMA table_info(probe)")}
        if "fingerprint" not in columns:
            self._connection.execute(
                "ALTER TABLE probe ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''"
            )

    def existing_keys(self) -> set[tuple[str, str, str]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT seed_id, probe, fingerprint FROM probe"
            ).fetchall()
        return {(row[0], row[1], row[2]) for row in rows}

    def put_many(self, records: Sequence[tuple[str, str, str, SearchResult]]) -> None:
        payload = [
            (
                seed_id,
                probe,
                fingerprint,
                result.http_status,
                json.dumps(list(result.place_ids)),
                result.error_message,
            )
            for seed_id, probe, fingerprint, result in records
        ]
        with self._lock:
            self._connection.executemany(
                "INSERT OR REPLACE INTO probe (seed_id, probe, fingerprint, status, ids, error)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                payload,
            )
            self._connection.commit()

    def load(self, probes: Iterable[str] | None = None) -> dict[str, dict[str, SearchResult]]:
        query = "SELECT seed_id, probe, status, ids, error FROM probe"
        parameters: tuple[Any, ...] = ()
        if probes is not None:
            names = tuple(probes)
            placeholders = ",".join("?" for _ in names)
            query += f" WHERE probe IN ({placeholders})"
            parameters = names
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
        result: dict[str, dict[str, SearchResult]] = {}
        for seed_id, probe, status, ids, error in rows:
            result.setdefault(seed_id, {})[probe] = SearchResult(
                tuple(json.loads(ids)), status, error
            )
        return result

    def get(self, seed_id: str, probe: str) -> SearchResult | None:
        """1件だけ引く。必要な probe だけを順に取る使い方（`adaptive_probe`）で使う。"""

        with self._lock:
            row = self._connection.execute(
                "SELECT status, ids, error FROM probe WHERE seed_id = ? AND probe = ?",
                (seed_id, probe),
            ).fetchone()
        if row is None:
            return None
        return SearchResult(tuple(json.loads(row[1])), row[0], row[2])

    def put(self, seed_id: str, probe: str, result: SearchResult, body: dict) -> None:
        fingerprint = hashlib.sha256(
            json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]
        self.put_many([(seed_id, probe, fingerprint, result)])

    def flush(self) -> None:
        with self._lock:
            self._connection.commit()

    def close(self) -> None:
        with self._lock:
            self._connection.close()


def execute_probes(
    specs: Sequence[ProbeSpec],
    client: FreePlacesClient,
    cache: ProbeCache,
    *,
    workers: int = 8,
    flush_every: int = 200,
    progress: Callable[[int, int], None] | None = None,
) -> int:
    """未取得の probe だけを並列実行し、キャッシュへ書き戻す。実行件数を返す。"""

    done = cache.existing_keys()
    pending = [
        spec for spec in specs if (spec.seed_id, spec.probe, spec.fingerprint) not in done
    ]
    if not pending:
        return 0

    buffer: list[tuple[str, str, str, SearchResult]] = []
    buffer_lock = threading.Lock()
    completed = 0

    def run(spec: ProbeSpec) -> None:
        nonlocal completed
        if spec.kind == "text":
            result = client.search_text(spec.body)
        elif spec.kind == "nearby":
            result = client.search_nearby(spec.body)
        else:
            raise ValueError(f"未知の probe kind: {spec.kind}")
        with buffer_lock:
            buffer.append((spec.seed_id, spec.probe, spec.fingerprint, result))
            completed += 1
            should_flush = len(buffer) >= flush_every
            snapshot = completed
            if should_flush:
                batch, buffer[:] = list(buffer), []
        if should_flush:
            cache.put_many(batch)
        if progress and snapshot % flush_every == 0:
            progress(snapshot, len(pending))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(run, pending))

    if buffer:
        cache.put_many(buffer)
    if progress:
        progress(completed, len(pending))
    return completed
