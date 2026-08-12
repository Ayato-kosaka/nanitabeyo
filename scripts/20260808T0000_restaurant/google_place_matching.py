"""Google Text Search (New) による Place ID 名寄せの純粋ルールとHTTP client。

重要な方針:
- 取得するGoogleフィールドは ``places.id`` だけに限定する。
- 1本の検索結果や先頭順位だけでは採用しない。
- 「名称 + 150m bias」と「名称 + 住所（biasなし）」がそれぞれ一意で、
  同じIDを返した場合だけ自動確定する。

判定関数をHTTP処理から分離しているのは、Googleの応答を再現せずとも名寄せの
採否を単体テストで固定するためである。
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
ALGORITHM_VERSION = "double-text-search-id-only-v1"


@dataclass(frozen=True)
class TextSearchResult:
    place_ids: tuple[str, ...]
    http_status: int | None
    error_message: str | None = None


@dataclass(frozen=True)
class MatchDecision:
    matched_place_id: str | None
    status: str


def build_query_payloads(
    name: str,
    address: str,
    latitude: float,
    longitude: float,
    radius_m: float = 150.0,
) -> tuple[str, str, dict[str, Any], dict[str, Any]]:
    """監査用query文字列とText Search request bodyを組み立てる。"""

    query_a = name.strip()
    query_b = " ".join(part for part in (name.strip(), address.strip()) if part)
    common = {
        "languageCode": "ja",
        "regionCode": "JP",
        # 2件以上なら曖昧判定できればよい。上限20件を取得する必要はない。
        "pageSize": 5,
        "includePureServiceAreaBusinesses": False,
    }
    body_a = {
        **common,
        "textQuery": query_a,
        "locationBias": {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": radius_m,
            }
        },
    }
    body_b = {**common, "textQuery": query_b}
    return query_a, query_b, body_a, body_b


def decide_match(
    result_a: TextSearchResult,
    result_b: TextSearchResult,
    *,
    has_address: bool,
) -> MatchDecision:
    """2検索の結果から自動採用可否を決める、唯一の判定関数。"""

    if not has_address:
        return MatchDecision(None, "ineligible_missing_address")
    if result_a.http_status != 200 or result_b.http_status != 200:
        return MatchDecision(None, "api_error")
    if len(result_a.place_ids) == 0 or len(result_b.place_ids) == 0:
        return MatchDecision(None, "unmatched")
    if len(result_a.place_ids) != 1 or len(result_b.place_ids) != 1:
        return MatchDecision(None, "ambiguous")
    if result_a.place_ids[0] != result_b.place_ids[0]:
        return MatchDecision(None, "query_disagreement")
    return MatchDecision(result_a.place_ids[0], "double_query_agree")


class PlacesTextSearchClient:
    """標準ライブラリだけでText Search (New)を呼ぶ小さなclient。

    API keyをURLへ付けずheaderに置き、例外メッセージやアクセスログへ露出しにくくする。
    429/5xxだけを指数backoffで再試行し、恒久的な4xxは即座に監査ログへ返す。
    """

    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = 15.0,
        max_retries: int = 4,
        qps: float = 5.0,
    ) -> None:
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.minimum_interval_seconds = 1.0 / qps
        self._last_request_at: float | None = None

    def _throttle(self) -> None:
        if self._last_request_at is not None:
            elapsed = time.monotonic() - self._last_request_at
            time.sleep(max(0.0, self.minimum_interval_seconds - elapsed))
        self._last_request_at = time.monotonic()

    def search(self, payload: dict[str, Any]) -> TextSearchResult:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            TEXT_SEARCH_URL,
            data=encoded,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Goog-Api-Key": self.api_key,
                # ID Only SKUを維持し、Google由来の名称・住所を保存しない。
                "X-Goog-FieldMask": "places.id",
            },
        )

        for attempt in range(self.max_retries + 1):
            # qpsはseed数ではなくHTTP request数で制限する。1seedにつき2 query
            # なので、この位置でthrottleしないと指定値の約2倍を送ってしまう。
            self._throttle()
            try:
                with urllib.request.urlopen(
                    request, timeout=self.timeout_seconds
                ) as response:
                    payload_json = json.loads(response.read().decode("utf-8"))
                    ids = tuple(
                        dict.fromkeys(
                            place["id"]
                            for place in payload_json.get("places", [])
                            if isinstance(place, dict) and place.get("id")
                        )
                    )
                    return TextSearchResult(ids, int(response.status))
            except urllib.error.HTTPError as error:
                status = int(error.code)
                message = error.read(4096).decode("utf-8", errors="replace")
                if (
                    status not in {429, 500, 502, 503, 504}
                    or attempt >= self.max_retries
                ):
                    return TextSearchResult((), status, message[:4000])
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt >= self.max_retries:
                    return TextSearchResult((), None, str(error)[:4000])
            time.sleep(min(2**attempt, 16))

        raise AssertionError("retry loopは必ずreturnする")
