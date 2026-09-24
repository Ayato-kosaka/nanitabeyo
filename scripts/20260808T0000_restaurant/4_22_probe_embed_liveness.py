#!/usr/bin/env python3
"""#1947 D. 配信中の埋め込みが **まだ生きているか** を投稿単位で測る（BigQuery へ追記のみ）。

## なぜ要るか

配信は外部埋め込みなので、投稿が削除・非公開になった瞬間にユーザーには «壊れたもの» が届く。
受け皿は**既に全部揃っている**のに、**それを書く主体が居なかった**:

| 層 | 状態 |
| --- | --- |
| `dish_media_external_embeddings.embed_status`（unknown/available/unavailable） | 在る（索引まで） |
| API（`dish-media.assembler.ts`） | `embedStatus` を返す |
| アプリ（`ExternalEmbedPlayer.tsx`） | `unavailable` なら «利用できません» を出す |
| **死活を判定して書く処理** | **無かった** |

2026-09-18 の実測（配信カタログ `cat8` から無作為 202 件）: **削除済み 4.95%**
（95% 信頼区間 1.96〜7.94%）。`cat8` 全体だと約 26,700 行・約 3,300 店に相当する。
検出手段が無いので、**オーナーが実機で踏むまで誰も気づけない**構造だった。

## ⚠️ 判定の較正（実測。ここを推測で書くと必ず誤る）

**削除済みでも HTTP は 200 を返す。** ステータスだけを見る実装は «死亡ゼロ» と報告する。

| | HTTP | 埋め込み SSR の本文 |
| --- | --- | --- |
| 生存 | 200 | キャプションブロックが在る（`sns_html.caption_from_embed_html` が返す） |
| 削除・非公開 | **200** | `The link to this photo or video may be broken, or the post may have been removed.` |

判定は **`sns_html.caption_from_embed_html`（取り込みと同じ正本）** を使う。
ここで独自の正規表現を書くと、取り込み側と死活側で «生きている» の定義がずれる。

## ⚠️ `unknown` を `dead` に寄せない

provider が HTML を変えた日に **生きている投稿を一斉に «削除済み» と判定してしまう**。
`dead` と言い切るのは «キャプションが無い» ＋ «削除の文言が在る» の両方が揃ったときだけ。
どちらでもなければ `unknown` のまま残す（表示側は `unknown` を従来どおり試す）。

## 書き込み先は BigQuery だけ

`sns_embed_liveness` へ **append-only** で積む。PostgreSQL の
`dish_media_external_embeddings.embed_status` へ反映するのは**別ステップ**で、
**オーナーの承認が要る**（UPDATE になるため）。この script は PG に触らない。

使い方:

    python3 4_22_probe_embed_liveness.py --run-id live-2026-09-18 \\
        --catalog-run-id sns-2026-09-18-cat8 --limit 2000 --max-minutes 300
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "1273_instagram_seed_poc"))

from common_sns import (PROVIDER_INSTAGRAM, TABLE_DISH_MEDIA_CATALOG,  # noqa: E402
                        TABLE_EMBED_LIVENESS)
from pipeline_common import (BigQueryPipeline, configure_logging,  # noqa: E402
                             require_run_id, utc_now)
import pillar1_site_extract as p1  # noqa: E402  fetch は 4_4 / 4_10 と同じものを使う
import sns_html  # noqa: E402

LOGGER = logging.getLogger(__name__)

# 削除・非公開のときに埋め込み SSR が返す文言（2026-09-18 実測）。
# ⚠️ **文言で死活を判定しない。** #1947 2026-09-24 に真因が確定した:
# Instagram は削除通知を **閲覧者の言語で返す**。GitHub Actions の runner は日本語を受け取る
# ため、英語の文言（"may have been removed"）が 1 度も当たらず、**12,596 + 2,000 件すべてが
# `no_marker` に落ちて «dead 0.00%» と報告され続けていた**。
#
# 実測（同じ投稿・UA 固定で `Accept-Language` だけ変えた）:
#
# | Accept-Language | 本文 |
# | --- | --- |
# | 既定（英語） | `<div class="ebmMessage">The link to this photo or video may be broken, or the post may have been removed.</div>` |
# | `ja-JP` | `<div class="ebmMessage">写真・動画のリンクに問題があるか、投稿が削除された可能性があります。</div>` |
#
# **`ebmMessage` は言語に依らない**（削除 5 件で 1、生存 3 件で 0）。これを正にする。
# 文言は «構造が変わったとき気づく» ための副証拠として残す。
DEAD_STRUCTURE_MARKER = 'class="ebmMessage"'
DEAD_MARKERS = (
    DEAD_STRUCTURE_MARKER,
    "may have been removed",
    "isn't available",
    "投稿が削除された可能性があります",
)
# 生存のときだけ出る UI（キャプションが空の投稿でも出る）。
ALIVE_MARKERS = (
    "View profile",
    "View more on Instagram",
)

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS `__TABLE__` (
  provider      STRING NOT NULL,
  post_id       STRING NOT NULL,
  canonical_url STRING,
  liveness      STRING NOT NULL,
  evidence      STRING,
  http_status   INT64,
  checked_at    TIMESTAMP NOT NULL,
  run_id        STRING NOT NULL
)
PARTITION BY DATE(checked_at)
CLUSTER BY liveness, provider
OPTIONS (description = '配信中の外部埋め込みが生きているか（alive/dead/unknown）。append-only。#1947')
"""

# 未検査・検査が古いものから順に。**追記型なので post ごとの最新だけを見る。**
TARGETS_SQL = """
  WITH delivered AS (
    SELECT DISTINCT provider, external_content_id AS post_id, canonical_url
    FROM `__CATALOG__`
    WHERE run_id = @catalog_run_id AND provider = @provider
      AND external_content_id IS NOT NULL
  ), last_checked AS (
    SELECT provider, post_id, MAX(checked_at) AS checked_at
    FROM `__LIVENESS__`
    GROUP BY provider, post_id
  )
  SELECT d.provider, d.post_id, d.canonical_url
  FROM delivered d
  LEFT JOIN last_checked c USING (provider, post_id)
  ORDER BY c.checked_at IS NOT NULL, c.checked_at, d.post_id
  __LIMIT__
"""


def embed_url(post_id: str) -> str:
    """埋め込み SSR の URL。**固定の形しか作らない**（任意 URL を踏まないため）。"""
    return f"https://www.instagram.com/p/{post_id}/embed/captioned/"


def classify(raw: bytes | None, error: str | None) -> tuple[str, str]:
    """(liveness, evidence) を返す。**`unknown` を `dead` に寄せない。**"""

    if raw is None:
        return "unknown", f"fetch_failed:{(error or '')[:80]}"
    caption = sns_html.caption_from_embed_html(raw)
    text = raw.decode("utf-8", "replace")
    has_alive_ui = any(m in text for m in ALIVE_MARKERS)
    has_dead_mark = any(m in text for m in DEAD_MARKERS)
    if caption:
        return "alive", "caption_present"
    if has_alive_ui and not has_dead_mark:
        # キャプションが空の投稿。生きてはいる。
        return "alive", "alive_ui_no_caption"
    if has_dead_mark and not has_alive_ui:
        # どの印で判定したかを残す。構造の印だけが当たって文言が当たらない日が来たら、
        # それは «また別の言語が来た» の合図である（逆も同じ）。
        hit = "structure" if DEAD_STRUCTURE_MARKER in text else "text"
        return "dead", f"removal_notice:{hit}"
    # ⚠️ «印が 1 つも無い» は判定器が壊れている可能性を含む。本文の大きさを残しておくと
    # «JS シェルが返っていた» のような原因を BigQuery 側だけで切り分けられる（#1947）。
    return "unknown", f"no_marker:{len(raw)}b"


# #1947 «判定できない判定器を走らせ続けない»。2026-09-18 に、ブラウザ UA で JS シェルを
# 受け取り続けたまま 2,400 件を unknown で書き、Instagram へ無駄な問い合わせを積んだ。
# 原因が UA でも provider の HTML 変更でも同じなので、**原因ではなく «無signal» で止める。**
CALIBRATION_N = 50

#: «判定できなかった» がこの割合を超えたら、その run の dead 率は信じない。
#:
#: 2026-09-18 の run は **9,936 件で dead 0.00%** と報告したが、同じ run の 26% が
#: `no_marker`（印が 1 つも無い本文）だった。2026-09-24 に `no_marker` の URL を 2 件
#: 手で引き直したら、**1 件は «may have been removed» の削除通知が出ていた**。
#: つまり削除は `unknown` に紛れていて、**要約行だけ見ると «死亡ゼロ» に見える**。
#: 判定器そのものは壊れていない（今日の 2 件は alive / dead に正しく分かれる）ので、
#: **落とさずに «この数字は当てにならない» と言わせる**のが正しい。
UNKNOWN_SHARE_WARN = 0.10


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="配信中の埋め込みの死活を測る（BigQuery へ追記のみ）")
    p.add_argument("--run-id", default=None)
    p.add_argument("--catalog-run-id", required=True,
                   help="対象を取る sns_dish_media_catalog の run_id")
    p.add_argument("--provider", default=PROVIDER_INSTAGRAM)
    p.add_argument("--limit", type=int, default=2000, help="この run で見る投稿数の上限（0 で全件）")
    # #1947 収集と同じ理由で «時間» でも区切れるようにする（GitHub Actions は 6 時間で切られる）。
    p.add_argument("--max-minutes", type=int, default=0, help="この時間で切り上げる。0 で無制限")
    p.add_argument("--sleep-ms", type=int, default=1000,
                   help="1 件ごとの間隔。**測定であって収集ではない**ので既定 1 req/sec")
    p.add_argument("--no-bq-write", action="store_true", help="BigQuery へ書かない（数えるだけ）")
    p.add_argument("--calibration-n", type=int, default=CALIBRATION_N,
                   help="この件数までに alive/dead が 1 件も出なければ判定器が壊れているとみなして中止。0 で無効")
    return p.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    run_id = require_run_id(args.run_id)
    pipeline = BigQueryPipeline()
    from google.cloud import bigquery

    liveness_table = pipeline.table(TABLE_EMBED_LIVENESS)
    # 他の script と同じく «自分が書く表は自分で作る»（migration 頼みにしない。#1970）。
    pipeline.execute(CREATE_TABLE_SQL.replace("__TABLE__", liveness_table))

    sql = (TARGETS_SQL
           .replace("__CATALOG__", pipeline.table(TABLE_DISH_MEDIA_CATALOG))
           .replace("__LIVENESS__", liveness_table)
           .replace("__LIMIT__", f"LIMIT {int(args.limit)}" if args.limit else ""))
    targets = list(pipeline.execute(sql, [
        bigquery.ScalarQueryParameter("catalog_run_id", "STRING", args.catalog_run_id),
        bigquery.ScalarQueryParameter("provider", "STRING", args.provider),
    ]))
    LOGGER.info("%d 投稿を検査します（未検査・検査が古いものから）", len(targets))

    with pipeline.step(run_id, "4_22_probe_embed_liveness", parameters={
        "catalog_run_id": args.catalog_run_id, "provider": args.provider,
        "limit": args.limit, "max_minutes": args.max_minutes,
    }, repo_root=HERE.parents[1]) as result:
        rows: list[dict] = []
        counts: dict[str, int] = {}
        started = time.monotonic()
        budget = max(0, args.max_minutes) * 60
        written = 0

        def flush(*, force: bool = False) -> None:
            nonlocal written, rows
            if args.no_bq_write or not rows or (not force and len(rows) < 200):
                return
            written += pipeline.load_json_rows(TABLE_EMBED_LIVENESS, rows)
            LOGGER.info("%s へ %d 行（累計 %d）", TABLE_EMBED_LIVENESS, len(rows), written)
            rows = []

        for i, t in enumerate(targets, 1):
            # ⚠️ 既定のブラウザ UA では本文の無い JS シェルが返る（p1.fetch の注記）。
            raw, err = p1.fetch(embed_url(t["post_id"]), ua=p1.BOT_UA)
            liveness, evidence = classify(raw, err)
            counts[liveness] = counts.get(liveness, 0) + 1
            rows.append({
                "provider": t["provider"], "post_id": t["post_id"],
                "canonical_url": t["canonical_url"],
                "liveness": liveness, "evidence": evidence,
                # urllib は 4xx を例外にするので、成否は evidence 側に持たせる
                "http_status": 200 if raw is not None else None,
                "checked_at": utc_now().isoformat(), "run_id": run_id,
            })
            flush()
            if args.calibration_n and i >= args.calibration_n and not (
                    counts.get("alive", 0) or counts.get("dead", 0)):
                # 書けるぶんは残す（何が返っていたかが evidence に入っている）
                flush(force=True)
                result["row_count"] = written
                raise SystemExit(
                    f"判定器が {i} 件連続で判定できていません（{counts}）。"
                    "埋め込みの HTML が想定と違う可能性があるため中止します。"
                    f"`{TABLE_EMBED_LIVENESS}` の run_id={run_id} の evidence を見てください")
            if i % 100 == 0:
                LOGGER.info("  … %d/%d %s", i, len(targets), counts)
            if budget and (time.monotonic() - started) >= budget:
                LOGGER.info("--max-minutes %d に達したので %d 件で止めます", args.max_minutes, i)
                break
            time.sleep(max(0, args.sleep_ms) / 1000.0)

        flush(force=True)
        result["row_count"] = written
        total = sum(counts.values()) or 1
        unknown_share = counts.get("unknown", 0) / total
        LOGGER.info("結果: %s（dead %.2f%% / **判定できず %.2f%%**）",
                    counts, 100 * counts.get("dead", 0) / total, 100 * unknown_share)
        # ⚠️ 落とさない。判定器が壊れているとは限らず、«この run の dead 率を信じるな» と
        #    言えれば足りる。ここを赤くすると、本物の異常が埋もれる。
        if unknown_share > UNKNOWN_SHARE_WARN:
            LOGGER.warning(
                "⚠️ 判定できなかったものが %.1f%% あります。**この run の dead %% は当てになりません。**"
                " `%s` の run_id=%s を `evidence` で分けて、`no_marker:<bytes>` が何を返して"
                "いたかを見てください（過去に «本文の無い JS シェル» で 26%% が unknown になり、"
                "その中に本物の削除が紛れていました）。",
                100 * unknown_share, TABLE_EMBED_LIVENESS, run_id)


if __name__ == "__main__":
    main()
