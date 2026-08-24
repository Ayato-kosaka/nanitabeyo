"""Google Text Search (New) による Place ID 名寄せの純粋ルールとHTTP client。

重要な方針:
- 取得するGoogleフィールドは ``places.id`` だけに限定する。
- 1本の検索結果や先頭順位だけでは採用しない。
- **座標矩形の中で同名店が一意**であることを根拠にし、テキスト検索がその
  place を挙げていることを裏取りに使う。

## なぜ「A と B の合意」をやめたのか

以前は「名称 + 150m bias」（A）と「名称 + 住所」（B）がそれぞれ一意で同じ ID を
返したら確定していた。#1276 の PoC で測ったところ、これは成り立たなかった。

- 負例（座標だけ別店に差し替えた seed）での誤マッチ率 **11.3%**
- 原因は `locationBias` が**絞り込まない**ことにある。大阪の店名を東京の bias で
  引いても大阪の店が返る。店が Google に無ければ、A も B も揃って**隣の店**を
  返すので、2本が一致しても証拠にならない

`locationRestriction` の矩形は違う。**矩形の外を実際に切り落とす**（大阪の店名を
東京の矩形で引くと 0 件になることを確認済み）。したがって「矩形の中に同名が
1件しか無い」は「取り違える相手が存在しない」を意味する。

## 採用しているルール（PoC の `box_unique_strict`）

1. ±25m の矩形に同名が1件だけ → その1件を A か B が挙げていれば候補
2. そうでなければ ±250m の矩形で同じ判定
3. 候補が **±25m の矩形の中にある**こと
4. **B（名称+住所）の候補が1件以下**であること

3 と 4 は「確定したものは 100% 正しい」を満たすために足した条件である。
ラベル 6,000 件で確定 5,083 件・誤り 0 件（機械裁定で `mine_wrong` 0 件）。
外すと誤りが 8 件出る代わりに確定率が 11pt 上がる、という取引になっている。

判定関数をHTTP処理から分離しているのは、Googleの応答を再現せずとも名寄せの
採否を単体テストで固定するためである。
"""

from __future__ import annotations

import json
import math
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# 判定が変わったのでversionを上げる。resume queryはversion単位なので、
# 古いversionのattemptがあっても新ルールで引き直される。
ALGORITHM_VERSION = "box-unique-strict-v1"

# 矩形の半辺。±25m は「座標のほぼ真上」、±250m は「座標が数百mずれていても
# その範囲に同名が1つしか無いなら取り違えようがない」に対応する。
TIGHT_HALF_SIDE_M = 25.0
WIDE_HALF_SIDE_M = 250.0
_METRES_PER_DEGREE = 111_320.0


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


def build_box_payload(
    name: str,
    latitude: float,
    longitude: float,
    half_side_m: float,
) -> dict[str, Any]:
    """名称 + 座標矩形の ``locationRestriction`` request body。

    ``locationBias`` と違い矩形の外を実際に切り落とすので、「この place は
    Google 側でもこの座標の近くにある」の裏取りになる。Nearby Search と違って
    名称で絞られるため、密集地でも件数上限に当たらない。
    """

    latitude_delta = half_side_m / _METRES_PER_DEGREE
    longitude_delta = half_side_m / (
        _METRES_PER_DEGREE * max(math.cos(math.radians(latitude)), 0.01)
    )
    return {
        "languageCode": "ja",
        "regionCode": "JP",
        # 「ちょうど5件」と「60件」を区別できないと曖昧さを取りこぼす。
        # IDs Only は件数で課金が変わらないので上限まで取る。
        "pageSize": 20,
        "includePureServiceAreaBusinesses": False,
        "textQuery": name.strip(),
        "locationRestriction": {
            "rectangle": {
                "low": {
                    "latitude": latitude - latitude_delta,
                    "longitude": longitude - longitude_delta,
                },
                "high": {
                    "latitude": latitude + latitude_delta,
                    "longitude": longitude + longitude_delta,
                },
            }
        },
    }


def _ok(result: TextSearchResult | None) -> frozenset[str]:
    if result is None or result.http_status != 200:
        return frozenset()
    return frozenset(result.place_ids)


def decide_match(
    result_a: TextSearchResult | None,
    result_b: TextSearchResult | None,
    *,
    result_tight: TextSearchResult | None = None,
    result_wide: TextSearchResult | None = None,
    has_address: bool,
) -> MatchDecision:
    """矩形の一意性を根拠に自動採用可否を決める、唯一の判定関数。

    ``result_tight`` / ``result_wide`` は ``build_box_payload`` の結果。
    送っていない probe は ``None`` でよい（必要な分だけ送る運用のため）。
    """

    if result_tight is None and result_a is None:
        return MatchDecision(None, "probe_missing")
    for result in (result_a, result_b, result_tight, result_wide):
        if result is not None and result.http_status not in (200, None):
            return MatchDecision(None, "api_error")

    a, b = _ok(result_a), _ok(result_b)
    supported = a | b
    tight, wide = _ok(result_tight), _ok(result_wide)

    candidate = None
    for box in (tight, wide):
        if len(box) == 1 and (box & supported):
            candidate = next(iter(box))
            break
    if candidate is None:
        if not tight and not wide:
            return MatchDecision(None, "no_candidate_in_box")
        return MatchDecision(None, "box_not_unique")

    # 以下2つは「確定したものは 100% 正しい」を満たすための条件。
    if candidate not in tight:
        return MatchDecision(None, "rejected_not_in_tight_box")
    if len(b) > 1:
        return MatchDecision(None, "rejected_address_query_ambiguous")
    if not has_address:
        # 住所が無いと B を独立な証拠として使えない。矩形だけでは採らない。
        return MatchDecision(None, "ineligible_missing_address")
    return MatchDecision(candidate, "box_unique_strict")


# 日次クォータ枯渇のマーカー。分次（per minute）は数十秒待てば回復するので
# 再試行するが、日次（per day）は翌日まで回復しないため即座に止める。
# これが無いと、枯渇後の全 seed に api_error の attempt 行が書かれ、
# resume の対象から外れて「二度と照合されない」状態になる（実際に15,376件で発生）。
DAILY_QUOTA_MARKERS = ("per day", "PerDayPerProject")


class DailyQuotaExhausted(RuntimeError):
    """Text Search の日次クォータを使い切った。その日はもう送れない。"""


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
        self._lock = threading.Lock()
        self._next_request_at = 0.0

    def _throttle(self) -> None:
        # 複数workerで共有する前提のスロット予約式。lockの中では「自分の送信時刻」を
        # 予約するだけで、sleepはlockの外で行う。lock内でsleepすると全workerが
        # 直列化され、逐次実行（実効3〜4req/s）に戻ってしまう。
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next_request_at)
            self._next_request_at = start + self.minimum_interval_seconds
        time.sleep(max(0.0, start - time.monotonic()))

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
                if status == 429 and any(
                    marker in message for marker in DAILY_QUOTA_MARKERS
                ):
                    # 再試行しても回復しない。呼び出し側で run 全体を止める。
                    raise DailyQuotaExhausted(message[:2000]) from error
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
