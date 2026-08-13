#!/usr/bin/env python3
"""課金ゼロを構造的に保証する Places API (New) client。

このモジュールの唯一の責務は「無料SKU以外を絶対に呼ばない」ことである。
Google の課金は *リクエストしたフィールドマスク* で決まるため、フィールドマスクを
呼び出し側から受け取らず、モジュール定数として固定する。さらに応答側でも
``id`` 以外のキーが混入していないことを検査し、混入していれば即座に停止する。

使用する無料SKU:
- Text Search Essentials (IDs Only): FieldMask ``places.id`` のみ。$0.00 / 無制限。
- Nearby Search Essentials (IDs Only): FieldMask ``places.id`` のみ。$0.00 / 無制限。

``places.displayName`` や ``places.location`` 等を1つでも足すと Pro SKU に切り替わり
課金されるため、FIELD_MASK は定数であり引数化しない。
"""

from __future__ import annotations

import http.client
import json
import random
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Mapping

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"

# 無料SKUを維持する唯一のフィールドマスク。変更禁止。
FIELD_MASK = "places.id"

# 応答の place オブジェクトに現れてよいキー。これ以外が来たら課金SKUを踏んだ疑い。
ALLOWED_PLACE_KEYS = frozenset({"id"})

# 応答トップレベルで許容するキー（いずれも IDs Only SKU の範囲）。
ALLOWED_TOP_LEVEL_KEYS = frozenset({"places", "nextPageToken", "routingSummaries"})

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

# urllib は ``getresponse()`` 中の切断を URLError で包まない。長時間の一括実行では
# ``http.client.RemoteDisconnected`` が素通りして worker thread を落とし、実行全体が
# 中断する。到達性の問題は全て再試行対象として扱う。
RETRYABLE_EXCEPTIONS = (
    urllib.error.URLError,
    http.client.HTTPException,
    OSError,
    TimeoutError,
    json.JSONDecodeError,
)


class BillingGuardError(RuntimeError):
    """無料SKUを外れた可能性を検知したときに送出する。処理は継続しない。"""


@dataclass(frozen=True)
class SearchResult:
    """1回の検索の結果。place_id 以外は保持しない。"""

    place_ids: tuple[str, ...]
    http_status: int | None
    error_message: str | None = None

    @property
    def ok(self) -> bool:
        return self.http_status == 200


@dataclass
class RateLimiter:
    """スレッド間で共有する単純なトークンバケット。

    429 を受けたら要求間隔を伸ばし、成功が続いたら戻す。ペナルティの上限を
    低く、回復を速くしているのは、一度の 429 で実効 QPS が桁で落ちて実験が
    止まってしまうのを避けるためである（上限2秒・回復200件では、全スレッドが
    直列に2秒待ちへ縮退して事実上停止した）。
    """

    qps: float
    max_penalty_seconds: float = 0.2
    successes_before_recovery: int = 25
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _next_at: float = 0.0
    _penalty: float = 0.0
    _successes: int = 0
    _throttle_events: int = 0

    def acquire(self) -> None:
        with self._lock:
            interval = 1.0 / max(self.qps, 0.01) + self._penalty
            now = time.monotonic()
            start = max(now, self._next_at)
            self._next_at = start + interval
        delay = start - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def penalize(self) -> None:
        with self._lock:
            self._throttle_events += 1
            self._penalty = min(self._penalty + 0.02, self.max_penalty_seconds)
            self._successes = 0

    def reward(self) -> None:
        with self._lock:
            if self._penalty <= 0:
                return
            self._successes += 1
            if self._successes >= self.successes_before_recovery:
                self._penalty = max(0.0, self._penalty - 0.01)
                self._successes = 0

    @property
    def penalty_seconds(self) -> float:
        return self._penalty

    @property
    def throttle_events(self) -> int:
        return self._throttle_events


class FreePlacesClient:
    """IDs Only SKU だけを叩く HTTP client。"""

    def __init__(
        self,
        api_key: str,
        *,
        rate_limiter: RateLimiter,
        timeout_seconds: float = 20.0,
        max_retries: int = 4,
    ) -> None:
        if not api_key:
            raise ValueError("API key が空である")
        self._api_key = api_key
        self._rate_limiter = rate_limiter
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._counter_lock = threading.Lock()
        self.request_count = 0
        self.error_count = 0

    # -- public API ---------------------------------------------------------

    def search_text(self, body: Mapping[str, Any]) -> SearchResult:
        return self._post(TEXT_SEARCH_URL, body)

    def search_nearby(self, body: Mapping[str, Any]) -> SearchResult:
        return self._post(NEARBY_SEARCH_URL, body)

    # -- internals ----------------------------------------------------------

    def _post(self, url: str, body: Mapping[str, Any]) -> SearchResult:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                # key を URL ではなく header に置き、ログやエラー文へ露出させない。
                "X-Goog-Api-Key": self._api_key,
                "X-Goog-FieldMask": FIELD_MASK,
            },
        )
        for attempt in range(self._max_retries + 1):
            self._rate_limiter.acquire()
            with self._counter_lock:
                self.request_count += 1
            try:
                with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                    document = json.loads(response.read().decode("utf-8"))
                    self._rate_limiter.reward()
                    return SearchResult(extract_place_ids(document), int(response.status))
            except urllib.error.HTTPError as error:
                status = int(error.code)
                message = error.read(4096).decode("utf-8", errors="replace")
                if status == 429:
                    self._rate_limiter.penalize()
                if status not in RETRYABLE_STATUS or attempt >= self._max_retries:
                    with self._counter_lock:
                        self.error_count += 1
                    return SearchResult((), status, message[:2000])
            except RETRYABLE_EXCEPTIONS as error:
                if attempt >= self._max_retries:
                    with self._counter_lock:
                        self.error_count += 1
                    return SearchResult((), None, str(error)[:2000])
            time.sleep(min(2**attempt, 16) + random.random())
        raise AssertionError("retry loop は必ず return する")


def extract_place_ids(document: Mapping[str, Any]) -> tuple[str, ...]:
    """応答を検査し、place_id だけを重複排除して取り出す。

    IDs Only SKU なら place オブジェクトのキーは ``id`` だけになる。それ以外が
    現れたら、想定外のフィールドが課金対象として計上された可能性があるため、
    実験を止めて人間に判断させる。
    """

    unexpected_top = set(document) - ALLOWED_TOP_LEVEL_KEYS
    if unexpected_top:
        raise BillingGuardError(
            f"応答に想定外のトップレベルキーがある: {sorted(unexpected_top)}"
        )
    place_ids: list[str] = []
    for place in document.get("places", []) or []:
        if not isinstance(place, dict):
            raise BillingGuardError("places の要素が object ではない")
        unexpected = set(place) - ALLOWED_PLACE_KEYS
        if unexpected:
            raise BillingGuardError(
                f"応答に無料SKU外のフィールドがある: {sorted(unexpected)}"
            )
        identifier = place.get("id")
        if identifier:
            place_ids.append(identifier)
    return tuple(dict.fromkeys(place_ids))
