#!/usr/bin/env python3
"""#1273 SNS別 dish_media インポートPoC（無料範囲のみ）

各SNSの Discovery / Embed 経路が「課金なし・審査待ちなし」でどこまで実機動作するかを
検証する、再実行可能なPoCスクリプトです。

- 入力: fixtures/ 配下の投稿URL一覧・検索クエリ一覧（テキストファイル、1行1件、
  `#` で始まる行はコメントとして無視）
- 出力: out/ 配下にJSON（git管理外）。メタデータ（provider, permalink, author,
  embeddable可否, HTTPステータス）のみを書き出し、画像・動画バイナリは一切保存しない。
- 副作用: 外部SNS/GoogleのHTTP APIへのGETリクエストのみ。DB書き込みや他ファイルの
  変更は行わない。
- 失敗時挙動: 個々のHTTPリクエストの失敗は例外を握りつぶさず `error` フィールドに
  記録し、他のURL/クエリの処理は継続する（1件の失敗で全体を止めない）。ただし
  YOUTUBE_API_KEY 未設定など「資格情報が無い」場合は exit code 2 でfail closedし、
  推測値・シミュレーション結果を一切出力しない（#1269 と同じ方針）。
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parent
# #1273 【仕様】UAを明示しないと provider 側がbot判定してoEmbedを弾く場合があるため固定UAを付与
USER_AGENT = "nanitabeyo-sns-dish-media-poc/1.0 (+https://github.com/Ayato-kosaka/nanitabeyo)"


def now_iso() -> str:
    """現在時刻をUTC ISO8601文字列で返す。副作用なし。失敗しない。"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_lines(path: Path) -> list[str]:
    """fixtureファイルを読み、コメント行(`#`始まり)と空行を除いた値のリストを返す。

    入力: path — 1行1件のテキストファイル
    出力: 前後空白を除去した非空行のリスト（順序保持）
    副作用: なし（読み取り専用）
    失敗時挙動: ファイルが存在しない場合は FileNotFoundError をそのまま送出する
      （呼び出し元のCLI引数ミスをここで握りつぶさない）。
    """
    lines: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if not value or value.startswith("#"):
            continue
        lines.append(value)
    return lines


def http_get_json(url: str, *, timeout: float = 15.0) -> tuple[int, Any, str | None]:
    """GET リクエストを送りJSONとしてパースする。

    入力: url, timeout秒
    出力: (HTTPステータスコード, パース済みJSON or None, エラーメッセージ or None) の3要素タプル
    副作用: 外部への実HTTPリクエスト（GET）
    失敗時挙動: 例外を送出せず、HTTPError/URLError/timeout/JSONDecodeErrorを
      すべて戻り値のerrorフィールドに変換する。
      # #1273 【設計】呼び出し側(複数URL/クエリのループ)を例外処理まみれにしないため、
      # ここで一元的にエラーを値として返す方針に統一している。
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            body = response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, None, f"HTTPError: {exc.reason}"
    except urllib.error.URLError as exc:
        return 0, None, f"URLError: {exc.reason}"
    except TimeoutError:
        return 0, None, "timeout"
    try:
        return status, json.loads(body.decode("utf-8")), None
    except json.JSONDecodeError as exc:
        return status, None, f"JSONDecodeError: {exc}"


@dataclass(frozen=True)
class OembedResult:
    """1件のoEmbed呼び出し結果。dish_media_catalogに載せる想定の最小フィールドのみ保持する。"""

    provider: str
    url: str
    http_status: int
    oembed_ok: bool
    author_name: str | None
    provider_name: str | None
    has_thumbnail: bool
    has_html: bool
    error: str | None
    checked_at: str


def check_tiktok_oembed(url: str) -> OembedResult:
    """TikTok公式oEmbed(`https://www.tiktok.com/oembed`)を呼び、embed可否を判定する。

    入力: TikTok動画のパーマリンクURL
    出力: OembedResult（認証不要・無料経路のため requires_auth/requires_api_key は
      呼び出し元の run_oembed_check 側で固定値として付与する）
    副作用: 外部HTTPリクエスト1回
    失敗時挙動: http_get_json のエラーをそのまま OembedResult.error に転記し、
      oembed_ok=False として返す（例外は送出しない）。
    """
    endpoint = "https://www.tiktok.com/oembed?" + urllib.parse.urlencode({"url": url})
    status, payload, error = http_get_json(endpoint)
    ok = status == 200 and isinstance(payload, dict) and "html" in payload
    return OembedResult(
        provider="tiktok",
        url=url,
        http_status=status,
        oembed_ok=ok,
        author_name=(payload or {}).get("author_name") if isinstance(payload, dict) else None,
        provider_name=(payload or {}).get("provider_name") if isinstance(payload, dict) else None,
        has_thumbnail=bool((payload or {}).get("thumbnail_url")) if isinstance(payload, dict) else False,
        has_html=bool((payload or {}).get("html")) if isinstance(payload, dict) else False,
        error=error,
        checked_at=now_iso(),
    )


def check_x_oembed(url: str) -> OembedResult:
    """X公式oEmbed(`https://publish.x.com/oembed`)を呼び、embed可否を判定する。

    # #1273 【仕様】X Search API(Discovery)はpay-per-useのため本PoCでは使わない。
    # oEmbedは公式ドキュメント上「認証不要・rate limitなし」とされる別経路であり、
    # Embed可否の検証だけならSearch APIの課金は発生しない。
    入力/出力/副作用/失敗時挙動は check_tiktok_oembed と同一。
    """
    endpoint = "https://publish.x.com/oembed?" + urllib.parse.urlencode({"url": url, "omit_script": "true"})
    status, payload, error = http_get_json(endpoint)
    ok = status == 200 and isinstance(payload, dict) and "html" in payload
    return OembedResult(
        provider="x",
        url=url,
        http_status=status,
        oembed_ok=ok,
        author_name=(payload or {}).get("author_name") if isinstance(payload, dict) else None,
        provider_name=(payload or {}).get("provider_name") if isinstance(payload, dict) else None,
        has_thumbnail=bool((payload or {}).get("thumbnail_url")) if isinstance(payload, dict) else False,
        has_html=bool((payload or {}).get("html")) if isinstance(payload, dict) else False,
        error=error,
        checked_at=now_iso(),
    )


def run_oembed_check(provider_fn, urls: Sequence[str]) -> dict[str, Any]:
    """provider_fn を全URLに適用し、成功率つきのサマリJSONを組み立てる。

    入力: provider_fn(url) -> OembedResult な関数、対象URL列
    出力: out/*.json にそのまま書き出せる dict
    副作用: なし（provider_fn 呼び出しに伴うHTTPリクエストのみ）
    失敗時挙動: 個々のURLの失敗は results に残したうえで oembed_ok_rate に反映するだけで、
      関数全体は例外を出さない。
    """
    results = [provider_fn(url) for url in urls]
    ok_count = sum(1 for r in results if r.oembed_ok)
    return {
        "checked_at": now_iso(),
        "total": len(results),
        "oembed_ok": ok_count,
        "oembed_ok_rate": round(ok_count / len(results), 4) if results else None,
        # #1273 【仕様】TikTok/X oEmbedはどちらも認証・APIキーが不要な公開エンドポイントのため固定値
        "requires_auth": False,
        "requires_api_key": False,
        "cost": "free",
        "results": [asdict(r) for r in results],
    }


def cmd_tiktok_oembed_check(args: argparse.Namespace) -> int:
    urls = read_lines(Path(args.urls))
    output = run_oembed_check(check_tiktok_oembed, urls)
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"tiktok oembed: {output['oembed_ok']}/{output['total']} ok -> {args.output}")
    return 0


def cmd_x_oembed_check(args: argparse.Namespace) -> int:
    urls = read_lines(Path(args.urls))
    output = run_oembed_check(check_x_oembed, urls)
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"x oembed: {output['oembed_ok']}/{output['total']} ok -> {args.output}")
    return 0


def require_youtube_api_key() -> str:
    """YOUTUBE_API_KEY を環境変数からのみ読む。ファイルへの資格情報保存はしない方針。

    # #1273 【セキュリティ】#1269のInstagram PoCと同じく、資格情報はファイル/出力に
    # 書かず環境変数だけから読む。未設定時は推測値を作らずexit code 2でfail closedする。
    失敗時挙動: 未設定なら標準エラーに理由を出したうえで sys.exit(2)。
    """
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        print(
            "YOUTUBE_API_KEY is not set. Fail closed: no simulated results are produced.",
            file=sys.stderr,
        )
        sys.exit(2)
    return api_key


def cmd_youtube_search(args: argparse.Namespace) -> int:
    """YouTube Data API v3 search.list によるカテゴリ横断Discoveryのスモークテスト。

    # #1273 【パフォーマンス】search.list は maxResults に関わらず一律100 units消費する
    # (無料枠は1日10,000 units = 約100回/日)。134カテゴリ全部を1回で回すと13,400 units
    # となり無料枠を超過するため、呼び出し側(fixtures/youtube_sample_queries.txt)で
    # クエリ数を絞ることを前提にしている。
    # #1273 【仕様】embeddableでない動画はアプリに表示できず「取得できた」と呼ぶべきでは
    # ないため、search.list の生ヒットをそのまま結果として返さず、必ず videos.list で
    # embeddable確認してから embeddable なものだけを video_ids/titles に残す設計にしている
    # (レビュー指摘: 「合計76/78動画がembeddable」という中間報告のように、非embeddableが
    # 結果に混ざって見える状態を避ける)。非embeddableは rejected_non_embeddable に分離して
    # funnelの可視性は維持する。
    """
    api_key = require_youtube_api_key()
    queries = read_lines(Path(args.queries))
    raw_per_query: list[dict[str, Any]] = []
    search_units = 0
    for query in queries:
        endpoint = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode(
            {
                "part": "snippet",
                "q": query,
                "type": "video",
                "maxResults": args.max_results,
                "relevanceLanguage": "ja",
                "regionCode": "JP",
                "key": api_key,
            }
        )
        status, payload, error = http_get_json(endpoint)
        search_units += 100  # search.list は固定100 units/call
        items = (payload or {}).get("items", []) if isinstance(payload, dict) else []
        hits = [
            {"video_id": item["id"]["videoId"], "title": item.get("snippet", {}).get("title")}
            for item in items
            if item.get("id", {}).get("videoId")
        ]
        raw_per_query.append({"query": query, "http_status": status, "error": error, "hits": hits})

    # 全クエリ分のvideo_idをまとめてembeddable確認(videos.listは50件/1 unitとsearch.listより桁違いに安い)
    all_video_ids = [hit["video_id"] for row in raw_per_query for hit in row["hits"]]
    embeddable_by_id, embed_units = fetch_youtube_embeddable(all_video_ids, api_key)

    per_query: list[dict[str, Any]] = []
    for row in raw_per_query:
        accepted: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        for hit in row["hits"]:
            info = embeddable_by_id.get(hit["video_id"], {})
            if info.get("embeddable") is True:
                accepted.append(hit)
            else:
                rejected.append({**hit, "reason": "not_embeddable" if info.get("found") else "not_found"})
        per_query.append(
            {
                "query": row["query"],
                "http_status": row["http_status"],
                "error": row["error"],
                "raw_hit_count": len(row["hits"]),
                "result_count": len(accepted),  # embeddableなものだけを「取得できた」件数とする
                "video_ids": [hit["video_id"] for hit in accepted],
                "titles": [hit["title"] for hit in accepted],
                "rejected_non_embeddable": rejected,
            }
        )
    output = {
        "checked_at": now_iso(),
        "queries": len(queries),
        "quota_units_consumed": search_units + embed_units,
        "quota_note": "search.list costs 100 units/call; videos.list costs 1 unit/call(<=50 ids); free daily quota is 10,000 units/day.",
        "cost": "free (within daily quota)",
        "requires_api_key": True,
        "embeddable_only": True,
        "results": per_query,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    total_hits = sum(r["result_count"] for r in per_query)
    total_rejected = sum(len(r["rejected_non_embeddable"]) for r in per_query)
    print(
        f"youtube search: {total_hits} embeddable videos ({total_rejected} rejected as non-embeddable) "
        f"across {len(queries)} queries, {search_units + embed_units} units -> {args.output}"
    )
    return 0


def fetch_youtube_embeddable(video_ids: Sequence[str], api_key: str) -> tuple[dict[str, dict[str, Any]], int]:
    """videos.list で複数video_idのstatus.embeddable等をまとめて取得する。

    # #1273 【パフォーマンス】videos.list は id を最大50件まとめて渡せて1 unit/call
    # (search.listの100 unitsに比べて非常に安い)。cmd_youtube_embed_check と
    # discover-restaurant-dish-media パイプラインの両方から使うため関数化している。
    入力: video_id列, YouTube Data API v3 キー
    出力: (video_id -> {embeddable, privacy_status, channel_title, description, http_status, error} の辞書, 消費units)
    副作用: 外部HTTPリクエスト(50件ごとに1回)
    失敗時挙動: 個々のバッチのHTTPエラーは該当video_idの `error` に記録し、処理は継続する。
    """
    by_video_id: dict[str, dict[str, Any]] = {}
    units_consumed = 0
    batch_size = 50  # videos.list の id パラメータ上限
    unique_ids = list(dict.fromkeys(video_ids))  # 順序を保ったまま重複排除
    for i in range(0, len(unique_ids), batch_size):
        batch = unique_ids[i : i + batch_size]
        endpoint = "https://www.googleapis.com/youtube/v3/videos?" + urllib.parse.urlencode(
            {"part": "status,snippet", "id": ",".join(batch), "key": api_key}
        )
        status, payload, error = http_get_json(endpoint)
        units_consumed += 1  # videos.list は id件数によらず1 unit/call
        items = (payload or {}).get("items", []) if isinstance(payload, dict) else []
        by_id = {item["id"]: item for item in items}
        for video_id in batch:
            item = by_id.get(video_id)
            by_video_id[video_id] = {
                "found": item is not None,
                "embeddable": (item or {}).get("status", {}).get("embeddable") if item else None,
                "privacy_status": (item or {}).get("status", {}).get("privacyStatus") if item else None,
                "channel_title": (item or {}).get("snippet", {}).get("channelTitle") if item else None,
                # #1273 【設計】videos.list は part=snippet で概要欄(description)も既に取得済み
                # (追加quota無し)。search.listのsnippet.descriptionは短く切り詰められるため、
                # discover-restaurant-dish-media の店名マッチングでは代わりにこちらを使う。
                "description": (item or {}).get("snippet", {}).get("description") if item else None,
                "http_status": status,
                "error": error,
            }
    return by_video_id, units_consumed


def cmd_youtube_embed_check(args: argparse.Namespace) -> int:
    """YouTube Data API v3 videos.list で status.embeddable を確認するCLIコマンド。"""
    api_key = require_youtube_api_key()
    video_ids: list[str] = []
    if args.video_ids:
        video_ids = read_lines(Path(args.video_ids))
    elif args.from_search:
        search_payload = json.loads(Path(args.from_search).read_text(encoding="utf-8"))
        for row in search_payload.get("results", []):
            video_ids.extend(row.get("video_ids", []))
    if not video_ids:
        print("no video ids to check (pass --video-ids or --from-search)", file=sys.stderr)
        return 1

    by_video_id, units_consumed = fetch_youtube_embeddable(video_ids, api_key)
    unique_ids = list(dict.fromkeys(video_ids))
    results = [{"video_id": vid, **by_video_id[vid]} for vid in unique_ids]
    embeddable_count = sum(1 for r in results if r["embeddable"] is True)
    output = {
        "checked_at": now_iso(),
        "total": len(results),
        "embeddable": embeddable_count,
        "embeddable_rate": round(embeddable_count / len(results), 4) if results else None,
        "quota_units_consumed": units_consumed,
        "cost": "free (within daily quota)",
        "requires_api_key": True,
        "results": results,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"youtube embed check: {embeddable_count}/{len(results)} embeddable, {units_consumed} units -> {args.output}")
    return 0


def run_ytdlp_search(query: str, *, max_results: int, timeout: float = 40.0) -> dict[str, Any]:
    """yt-dlpの`ytsearchN:`機能でYouTube検索する。quota消費なし・APIキー不要。

    # #1273 【設計】YouTube Data API v3のsearch.listは無料枠が1日10,000 units
    # (134カテゴリ全量だと13,400 unitsで超過)しかない。yt-dlpは公式APIを経由せず
    # 検索結果ページを解析するため、Google側のquotaを一切消費しない。本番で
    # カテゴリ数・地域数を広げる際の代替/補完手段として実機確認した。
    # #1273 【将来対応】ただしyt-dlpはYouTube/TikTok等の利用規約上「非公式なスクレイピング」
    # であり、公式APIのように利用が保証されているわけではない。本番採用時は
    # 法務確認とfallback設計(公式APIへの切り戻し)を別途検討すること。
    入力: query文字列, 取得件数上限
    出力: dict(query, video_ids, titles, channel_titles, error)
    副作用: `yt-dlp`コマンドをサブプロセスとして起動する。--skip-downloadを常に付け、
      動画・音声本体は一切ダウンロードしない(メタデータのみ)。
    失敗時挙動: yt-dlpが見つからない/非ゼロ終了/タイムアウトのいずれでも例外を投げず、
      `error`フィールドにメッセージを残し、video_ids等は空リストで返す。
    """
    if shutil.which("yt-dlp") is None:
        return {"query": query, "video_ids": [], "titles": [], "channel_titles": [], "error": "yt-dlp not installed"}
    cmd = [
        "yt-dlp",
        f"ytsearch{max_results}:{query}",
        "--dump-json",
        "--flat-playlist",
        "--skip-download",
        "--no-warnings",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"query": query, "video_ids": [], "titles": [], "channel_titles": [], "error": "timeout"}
    if proc.returncode != 0:
        return {
            "query": query,
            "video_ids": [],
            "titles": [],
            "channel_titles": [],
            "error": proc.stderr.strip()[-500:] or f"yt-dlp exited {proc.returncode}",
        }
    video_ids, titles, channels = [], [], []
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        video_ids.append(entry.get("id"))
        titles.append(entry.get("title"))
        channels.append(entry.get("channel"))
    return {"query": query, "video_ids": video_ids, "titles": titles, "channel_titles": channels, "error": None}


def cmd_youtube_search_ytdlp(args: argparse.Namespace) -> int:
    queries = read_lines(Path(args.queries))
    results = [run_ytdlp_search(q, max_results=args.max_results) for q in queries]
    output = {
        "checked_at": now_iso(),
        "queries": len(queries),
        "quota_units_consumed": 0,
        "cost": "free (no Google API quota consumed; scrapes search result pages via yt-dlp)",
        "requires_api_key": False,
        # #1273 【将来対応】ToS上のグレーゾーンであることをJSON出力にも明記しておく
        "caveat": "yt-dlp bypasses the official YouTube Data API; review Terms of Service before production use.",
        "results": results,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    total_hits = sum(len(r["video_ids"]) for r in results)
    print(f"youtube search (yt-dlp): {total_hits} videos across {len(queries)} queries, 0 units -> {args.output}")
    return 0


@dataclass(frozen=True)
class DishMediaCatalogRow:
    """issue #1273 で提案されている `dish_media_catalog` テーブル相当の1行。

    # #1273 【設計】このPoCではPostgreSQL/BigQueryへは書き込まず、同じ列構成の
    # JSONとしてローカルに出力するだけに留める(スキーマ変更は本issueのスコープ外)。
    """

    google_place_id: str
    category_id: str
    provider: str
    external_content_id: str
    canonical_url: str
    thumbnail_url: str | None
    media_type: str
    availability_status: str
    restaurant_match_confidence: float
    category_confidence: float
    published_at: str | None
    last_verified_at: str
    build_run_id: str


@dataclass(frozen=True)
class DishMediaExternalEmbeddingRow:
    """issue #1273 で提案されている `dish_media_external_embeddings` テーブル相当の1行。"""

    dish_media_id: str
    provider: str
    external_content_id: str
    canonical_url: str
    sanitized_embed_html: str
    cache_expires_at: str
    availability_status: str
    last_verified_at: str


def youtube_iframe_embed_html(video_id: str, title: str) -> str:
    """YouTube公式ドキュメント記載の標準iframe埋め込みHTMLを組み立てる。

    # #1273 【セキュリティ】title は動画タイトル(利用者制御外の外部入力)なので、
    # iframeのtitle属性に差し込む前に html.escape で必ずエスケープする。
    """
    safe_title = html.escape(title or "", quote=True)
    return (
        f'<iframe width="560" height="315" src="https://www.youtube.com/embed/{video_id}" '
        f'title="{safe_title}" frameborder="0" '
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
        "referrerpolicy=\"strict-origin-when-cross-origin\" allowfullscreen></iframe>"
    )


def text_match_confidence(needle: str, haystack: str) -> float:
    """needle(カテゴリ名など)がhaystackに部分文字列として含まれるかだけを見る。

    # #1273 【仕様】画像/キャプションAI分類はissue本文の方針上Phase 2扱い(#26)。
    # PoC段階では「テキストに文字列が実際に含まれているか」という検証可能な弱い
    # シグナルのみを使い、これをprecisionの根拠として過大に報告しない
    # (#1269 の『synthetic fixtureの精度を本番precisionとして報告しない』方針を踏襲)。
    """
    needle = (needle or "").strip()
    if not needle or not haystack:
        return 0.0
    return 1.0 if needle in haystack else 0.0


def normalize_core_restaurant_name(restaurant_name: str) -> str:
    """店名から括弧内の補足（業態説明・支店の但し書き等）を除いた「コア名」を取り出す。

    # #1273 【設計】v1(タイトル完全一致のみ)は歩留まり5%と低く、レビューで改善を
    # 求められた。原因の一つは「とりろう（やきとり、刺身、おでん）」のような
    # 括弧付き店名が動画タイトルにそのままの形で出現しにくいこと。括弧以降を
    # 切り落としたコア名なら一致しやすくなるはずという仮説をv2で検証する。
    """
    core = (restaurant_name or "").strip()
    for open_paren in ("（", "("):
        idx = core.find(open_paren)
        if idx > 0:
            core = core[:idx]
            break
    return core.strip()


@dataclass(frozen=True)
class RestaurantMatchEvidence:
    """1候補動画に対する店名マッチングの評価結果。issue本文22項の強度階層を踏襲する。"""

    confidence: float
    evidence_type: str


# #1273 【設計】v2で概要欄マッチングを追加した結果、動画本編とは無関係な「撮影協力」
# クレジット欄に店名が載っているだけの誤検出(false positive)が実測で見つかった
# (例: 短編ドラマの撮影場所提供クレジットに店名が載っていただけ)。v3ではこれらの
# 「クレジット文脈」キーワードの直後に店名が出現するケースを機械的に除外する。
CREDIT_ONLY_CONTEXT_KEYWORDS = ("撮影協力", "取材協力", "ロケ協力", "協力：", "協力:", "提供：", "提供:")
CREDIT_CONTEXT_WINDOW_CHARS = 20


def _is_credit_context(text: str, match_index: int) -> bool:
    """match_indexの直前にクレジット文脈のキーワードが無いかを見る。"""
    prefix = text[max(0, match_index - CREDIT_CONTEXT_WINDOW_CHARS) : match_index]
    return any(keyword in prefix for keyword in CREDIT_ONLY_CONTEXT_KEYWORDS)


def evaluate_restaurant_match(
    restaurant_name: str, title: str, description: str, channel_title: str
) -> RestaurantMatchEvidence:
    """店名マッチングをissue本文22項の強度階層(Very strong/Strong/Medium)に沿って評価する。

    入力: restaurant_name(正式店名), title(動画タイトル), description(videos.list由来の
      全文概要欄), channel_title(投稿者チャンネル名)
    出力: RestaurantMatchEvidence。最も強い根拠を採用する:
      1.0 = 店名がそのままタイトルに出現(Very strong)
      0.9 = コア名(括弧以前)が投稿者チャンネル名に出現。運営者が店名を名乗っている
            強い状況証拠(issue22項「支店専用公式アカウント→その投稿」相当)
      0.8 = コア名がタイトルに出現(Strong寄り)
      0.7 = 店名(全体 or コア名)が概要欄に出現し、かつ「撮影協力」等のクレジット文脈
            直後ではない(Medium。本パイプラインの採用ライン)
      0.0 = クレジット文脈での言及のみ、またはいずれの根拠も無い(issue22項の「Weak」に
            相当し不採用)
    副作用: なし。失敗時挙動: 入力が空文字の場合は 0.0 を返す(例外なし)。
    """
    restaurant_name = (restaurant_name or "").strip()
    title = title or ""
    description = description or ""
    channel_title = channel_title or ""
    if not restaurant_name:
        return RestaurantMatchEvidence(0.0, "none")

    if restaurant_name in title:
        return RestaurantMatchEvidence(1.0, "full_name_in_title")

    core = normalize_core_restaurant_name(restaurant_name)
    has_core = bool(core) and len(core) >= 2  # #1273 【仕様】2文字未満のコア名は誤マッチ率が高すぎるため除外

    if has_core and core in channel_title:
        return RestaurantMatchEvidence(0.9, "core_name_in_channel")
    if has_core and core in title:
        return RestaurantMatchEvidence(0.8, "core_name_in_title")

    # 概要欄は「撮影協力」等のクレジット表記に店名だけ載っているケースがあるため、
    # 一致箇所の直前がクレジット文脈かどうかを見てから採用/棄却を決める。
    for needle in (n for n in (restaurant_name, core if has_core else None) if n):
        idx = description.find(needle)
        if idx >= 0:
            if _is_credit_context(description, idx):
                return RestaurantMatchEvidence(0.0, "credit_context_only")
            return RestaurantMatchEvidence(0.7, "name_in_description")

    return RestaurantMatchEvidence(0.0, "none")


# #1273 【設計】issue本文22項で「Weakは採用しない」と明記されているため、Medium(0.7)
# 以上のみを採用ラインとする。0.7未満(=一致なし/クレジット文脈のみ)は candidates には
# 残すが catalog へは昇格させない。
RESTAURANT_MATCH_ACCEPT_THRESHOLD = 0.7


def cmd_discover_restaurant_dish_media(args: argparse.Namespace) -> int:
    """dev.dishes由来の実restaurant×category組でSNS media候補を探索するデモパイプライン(v2)。

    issue #1273 が提案するfunnel(candidate → restaurant match → category match →
    embed check → accepted dish_media)を、無料範囲で使えるYouTube Data API v3だけで
    最小構成で再現する。X/TikTokはoEmbedのみ無料でDiscovery機能が無いため、この
    パイプラインではYouTubeのみを対象にする。

    v1(タイトル完全一致のみ、maxResults=1)からの変更点:
      - 1リクエストあたり複数候補(--max-results)を評価し、最良の1件を採用する
      - 判定材料をタイトルだけでなく概要欄(videos.list由来の全文)・投稿者チャンネル名にも拡張
      - 店名の括弧以降を除いた「コア名」でのマッチも Medium 相当として許容する
      (evaluate_restaurant_match 参照。歩留まり改善ループの第2ラウンド)

    入力: --pairs で指定するCSV(restaurant_id, google_place_id, restaurant_name,
      dish_id, category_id, category_label_ja)。fixtures/restaurant_dish_sample_20.csv
      は dev.dishes / dev.restaurants / dev.dish_categories を実際にJOINして
      決定的サンプリング(SHA-256ハッシュ順)した20件。
    出力: dish_media_catalog相当・dish_media_external_embeddings相当のJSON2本と、
      funnel集計(candidate数→video_found数→restaurant_match数→embeddable数→accepted数)。
    副作用: YouTube Data API v3への読み取り専用リクエストのみ。DBへの書き込みはしない。
    失敗時挙動: YOUTUBE_API_KEY未設定ならfail closed(exit 2)。個々の行のHTTP失敗は
      その行をnot_foundとして記録し、他の行の処理は継続する。
    """
    api_key = require_youtube_api_key()
    build_run_id = f"1273-poc-{now_iso()}"

    with Path(args.pairs).open(encoding="utf-8") as f:
        pairs = list(csv.DictReader(f))

    # Step 1: candidate discovery (Route B寄り: "店名 カテゴリ名" でYouTube検索、上位N件を保持)
    per_restaurant_hits: list[dict[str, Any]] = []
    search_units = 0
    for row in pairs:
        query = f"{row['restaurant_name']} {row['category_label_ja']}"
        endpoint = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode(
            {
                "part": "snippet",
                "q": query,
                "type": "video",
                "maxResults": args.max_results,
                "relevanceLanguage": "ja",
                "regionCode": "JP",
                "key": api_key,
            }
        )
        status, payload, error = http_get_json(endpoint)
        search_units += 100  # search.list は固定100 units/call
        items = (payload or {}).get("items", []) if isinstance(payload, dict) else []
        hits = [
            {
                "video_id": item.get("id", {}).get("videoId"),
                "title": item.get("snippet", {}).get("title", ""),
                "channel_title": item.get("snippet", {}).get("channelTitle"),
                "published_at": item.get("snippet", {}).get("publishedAt"),
                "thumbnail_url": (item.get("snippet", {}).get("thumbnails", {}).get("high") or {}).get("url"),
            }
            for item in items
            if item.get("id", {}).get("videoId")
        ]
        per_restaurant_hits.append({**row, "query": query, "http_status": status, "search_error": error, "hits": hits})

    # Step 2: 全候補のvideo_idをまとめてembeddable確認 + 概要欄(全文)取得(videos.listは安いので一括実行)
    all_video_ids = [hit["video_id"] for row in per_restaurant_hits for hit in row["hits"]]
    embeddable_by_id, embed_units = fetch_youtube_embeddable(all_video_ids, api_key)

    # Step 3/4: restaurant match / category match を評価し、レストランごとに最良の1件を選ぶ
    candidates: list[dict[str, Any]] = []
    catalog_rows: list[dict[str, Any]] = []
    embedding_rows: list[dict[str, Any]] = []
    verified_at = now_iso()
    for row in per_restaurant_hits:
        evaluated: list[dict[str, Any]] = []
        for hit in row["hits"]:
            info = embeddable_by_id.get(hit["video_id"], {})
            description = info.get("description") or ""
            haystack = f"{hit['title']}\n{description}"  # カテゴリ一致判定にのみ使う簡易結合
            match = evaluate_restaurant_match(row["restaurant_name"], hit["title"], description, hit["channel_title"] or "")
            evaluated.append(
                {
                    **hit,
                    "description": description,
                    "embeddable": info.get("embeddable"),
                    "restaurant_match_confidence": match.confidence,
                    "restaurant_match_evidence": match.evidence_type,
                    "category_confidence": text_match_confidence(row["category_label_ja"], haystack),
                }
            )
        # 最良の1件 = restaurant_match_confidence最大、次点でcategory_confidence、次点でembeddable
        best = max(
            evaluated,
            key=lambda e: (e["restaurant_match_confidence"], e["category_confidence"], bool(e["embeddable"])),
            default=None,
        )

        candidate = {
            "restaurant_id": row["restaurant_id"],
            "google_place_id": row["google_place_id"],
            "restaurant_name": row["restaurant_name"],
            "dish_id": row["dish_id"],
            "category_id": row["category_id"],
            "category_label_ja": row["category_label_ja"],
            "query": row["query"],
            "raw_hit_count": len(row["hits"]),
            "best": best,
        }
        candidates.append(candidate)

        if best is None or not best["video_id"]:
            continue
        video_id = best["video_id"]
        embeddable = best["embeddable"]
        availability_status = "embeddable" if embeddable else "not_embeddable"

        # #1273 【仕様】採用ルールはissue本文23項の「Weakは採用しない」に倣い、
        # RESTAURANT_MATCH_ACCEPT_THRESHOLD(Medium)以上 かつ embeddable な候補だけを
        # dish_media_catalogへ格上げする。それ以外はcandidateのまま(REPORTのfunnelに残す)。
        if embeddable and best["restaurant_match_confidence"] >= RESTAURANT_MATCH_ACCEPT_THRESHOLD:
            dish_media_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"youtube:{video_id}"))
            canonical_url = f"https://www.youtube.com/watch?v={video_id}"
            catalog_rows.append(
                asdict(
                    DishMediaCatalogRow(
                        google_place_id=row["google_place_id"],
                        category_id=row["category_id"],
                        provider="youtube",
                        external_content_id=video_id,
                        canonical_url=canonical_url,
                        thumbnail_url=best["thumbnail_url"],
                        media_type="video",
                        availability_status=availability_status,
                        restaurant_match_confidence=best["restaurant_match_confidence"],
                        category_confidence=best["category_confidence"],
                        published_at=best["published_at"],
                        last_verified_at=verified_at,
                        build_run_id=build_run_id,
                    )
                )
            )
            embedding_rows.append(
                asdict(
                    DishMediaExternalEmbeddingRow(
                        dish_media_id=dish_media_id,
                        provider="youtube",
                        external_content_id=video_id,
                        canonical_url=canonical_url,
                        sanitized_embed_html=youtube_iframe_embed_html(video_id, best["title"]),
                        # #1273 【設計】埋め込み失効監視(issue本文39項)のためのTTL。PoCでは24hに固定。
                        cache_expires_at=(datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(
                            timespec="seconds"
                        ),
                        availability_status=availability_status,
                        last_verified_at=verified_at,
                    )
                )
            )

    def best_confidence(c: dict[str, Any]) -> float:
        return c["best"]["restaurant_match_confidence"] if c["best"] else 0.0

    funnel = {
        "candidates": len(candidates),
        "video_found": sum(1 for c in candidates if c["best"] and c["best"]["video_id"]),
        "restaurant_matched": sum(1 for c in candidates if best_confidence(c) >= RESTAURANT_MATCH_ACCEPT_THRESHOLD),
        "restaurant_matched_full_name": sum(1 for c in candidates if best_confidence(c) >= 1.0),
        "embeddable": sum(1 for c in candidates if c["best"] and c["best"]["embeddable"]),
        "accepted_to_catalog": len(catalog_rows),
    }
    output = {
        "checked_at": verified_at,
        "build_run_id": build_run_id,
        "quota_units_consumed": search_units + embed_units,
        "cost": "free (within daily quota)",
        "restaurant_match_accept_threshold": RESTAURANT_MATCH_ACCEPT_THRESHOLD,
        "funnel": funnel,
        "candidates": candidates,
        "dish_media_catalog": catalog_rows,
        "dish_media_external_embeddings": embedding_rows,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"discover-restaurant-dish-media: {funnel['candidates']} candidates -> "
        f"{funnel['restaurant_matched']} restaurant-matched -> {funnel['accepted_to_catalog']} accepted "
        f"({search_units + embed_units} units) -> {args.output}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("tiktok-oembed-check", help="Check TikTok oEmbed availability for a list of URLs (free, no key).")
    p.add_argument("--urls", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=cmd_tiktok_oembed_check)

    p = sub.add_parser("x-oembed-check", help="Check X (Twitter) oEmbed availability for a list of URLs (free, no key).")
    p.add_argument("--urls", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=cmd_x_oembed_check)

    p = sub.add_parser("youtube-search", help="Category-oriented Discovery smoke test via YouTube Data API v3 (free tier).")
    p.add_argument("--queries", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--max-results", type=int, default=5)
    p.set_defaults(func=cmd_youtube_search)

    p = sub.add_parser("youtube-embed-check", help="Check status.embeddable for YouTube video ids (free tier).")
    p.add_argument("--video-ids", help="path to newline-delimited video id file")
    p.add_argument("--from-search", help="path to a youtube-search output JSON to source video ids from")
    p.add_argument("--output", required=True)
    p.set_defaults(func=cmd_youtube_embed_check)

    p = sub.add_parser(
        "youtube-search-ytdlp",
        help="Category-oriented Discovery via yt-dlp (no API key, no Google quota; requires yt-dlp installed).",
    )
    p.add_argument("--queries", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--max-results", type=int, default=5)
    p.set_defaults(func=cmd_youtube_search_ytdlp)

    p = sub.add_parser(
        "discover-restaurant-dish-media",
        help="Build dish_media_catalog / dish_media_external_embeddings rows from real restaurant x category pairs.",
    )
    p.add_argument("--pairs", required=True, help="CSV: restaurant_id,google_place_id,restaurant_name,dish_id,category_id,category_label_ja")
    p.add_argument("--output", required=True)
    # #1273 【設計】v1はmaxResults=1(トップ1件のみ評価)で歩留まり5%だった。v2は複数候補を
    # 評価して最良の1件を選べるようデフォルトを3に引き上げる(search.list費用はmaxResultsに
    # 依存しないため追加quotaコストはゼロ)。
    p.add_argument("--max-results", type=int, default=3)
    p.set_defaults(func=cmd_discover_restaurant_dish_media)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
