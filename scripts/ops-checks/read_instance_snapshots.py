#!/usr/bin/env python3
"""`db-instance-snapshot.yml` が残したスナップショットを時系列で読む（#2006）。

## なぜ要るのか

`pg_stat_activity` は履歴を持たないので、事象が去ったあとに «あの時刻は何が起きていたか» を
聞くことができない。#2006（本番の重い読み取りが 09-21 から 18〜23 倍遅く、09-24 に自然復帰）は
それで原因を詰め切れなかった。`db-instance-snapshot.yml` が 30 分ごとに 1 行ずつ残すので、
**こちらはそれを並べて «遅かった時刻の列» を見る**。

## 差分を取るのは読む側の仕事である

`blks_hit` / `blks_read` / `temp_bytes` は **累計**である。累計をそのまま眺めても何も分からない
（起動以来の総和なので常に増える）。見たいのは «その 30 分で何ブロックディスクを読んだか» なので、
**ここで隣との差を取る**。スナップショット側で差を取らないのは、run が飛んだときに
前回がどれだけ前なのか分からなくなるからである（間隔も一緒に出す）。

⚠️ **run が飛んだ区間の差分は、1 区間ぶんではない。** `間隔` 列を見ること。

## 使い方

    GITHUB_TOKEN=... python3 scripts/ops-checks/read_instance_snapshots.py --hours 72

環境変数:
    GITHUB_TOKEN … repo の actions:read が要る（run のログを取るため）
"""

import argparse
import datetime as dt
import json
import logging
import os
import sys
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(message)s")
LOGGER = logging.getLogger(__name__)

REPO = "Ayato-kosaka/nanitabeyo"
WORKFLOW = "db-instance-snapshot.yml"


class _DropAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """リダイレクト先へ Authorization を持ち越さない。

    ⚠️ **ログ取得（`actions/jobs/{id}/logs`）は Azure Blob へ 302 する。**
    `urllib` は既定でヘッダを維持したまま追うので、Azure が
    `HTTP 401 Server failed to authenticate the request` を返す
    （実測。curl は既定でホストを越えると auth を落とすので気づきにくい）。
    GitHub の署名付き URL 自体に認可が入っているため、ヘッダは不要である。
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers = {k: v for k, v in new.headers.items() if k.lower() != "authorization"}
            new.unredirected_hdrs = {
                k: v for k, v in getattr(new, "unredirected_hdrs", {}).items() if k.lower() != "authorization"
            }
        return new


_OPENER = urllib.request.build_opener(_DropAuthOnRedirect)


def _api(path: str, token: str, raw: bool = False):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
    )
    with _OPENER.open(req) as res:
        body = res.read()
    return body.decode("utf-8", "replace") if raw else json.loads(body)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=48, help="何時間ぶん遡るか")
    parser.add_argument("--max-runs", type=int, default=200, help="読む run の上限（API 呼び出し数の歯止め）")
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        LOGGER.error("❌ GITHUB_TOKEN environment variable is required")
        return 1

    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=args.hours)
    runs = []
    page = 1
    while len(runs) < args.max_runs:
        try:
            listing = _api(f"actions/workflows/{WORKFLOW}/runs?per_page=100&page={page}", token)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                # ⚠️ **これはエラーではない。** workflow が既定ブランチに無いときの正常な応答である
                # （PR がまだマージされていない / 消された）。原因を取り違えないよう明示する
                LOGGER.error("❌ %s が既定ブランチに見つかりません（HTTP 404）。", WORKFLOW)
                LOGGER.error("   → まだ main にマージされていないか、消されています。")
                LOGGER.error("   → マージ前に読みたいときは、ブランチから workflow_dispatch で 1 回流してください。")
                return 1
            raise
        batch = listing.get("workflow_runs", [])
        if not batch:
            break
        stop = False
        for r in batch:
            created = dt.datetime.strptime(r["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
            if created < since:
                stop = True
                break
            if r["status"] == "completed":
                runs.append(r)
        if stop or len(batch) < 100:
            break
        page += 1

    if not runs:
        LOGGER.info("直近 %s 時間に完了した run がありません（workflow を有効にした直後ならこれが正常）", args.hours)
        return 0

    rows = []
    for r in sorted(runs, key=lambda x: x["created_at"]):
        try:
            jobs = _api(f"actions/runs/{r['id']}/jobs", token)["jobs"]
            log = _api(f"actions/jobs/{jobs[0]['id']}/logs", token, raw=True)
        except Exception as exc:  # run が消えている / ログ保持切れ
            LOGGER.warning("run %s のログが読めません（保持切れの可能性）: %s", r["id"], exc)
            continue
        # ⚠️ ログ行には ISO8601 のタイムスタンプが前置されるので、**行頭から探さない**
        for line in log.splitlines():
            idx = line.find('{"')
            if idx < 0:
                continue
            try:
                snap = json.loads(line[idx:])
            except json.JSONDecodeError:
                continue
            if "select1_ms" in snap and "blks_read" in snap:
                rows.append(snap)
                break

    if not rows:
        LOGGER.error("run は %s 本見つかりましたが、JSON 行が 1 つも取れませんでした。", len(runs))
        LOGGER.error("→ スナップショット側の出力形式が変わった可能性があります（1 行 JSON であること）")
        return 1

    LOGGER.info("=" * 100)
    LOGGER.info("# インスタンスの状態（%s 時間 / %s 点）", args.hours, len(rows))
    LOGGER.info("=" * 100)
    LOGGER.info(
        "  %-17s %8s %6s %6s %7s %12s %10s  %s",
        "時刻(UTC)", "SELECT1", "接続", "active", "間隔", "disk読/区間", "hit%", "最長クエリ",
    )
    LOGGER.info("  " + "-" * 96)
    prev = None
    for s in rows:
        ts = dt.datetime.fromisoformat(s["captured_at"])
        gap = f"{(ts - prev[0]).total_seconds() / 60:.0f}分" if prev else "-"
        dread = f"{s['blks_read'] - prev[1]:,}" if prev else "-"
        longest = s.get("longest_running")
        lon = f"{longest['seconds']:.0f}s {longest['user']} {longest['wait']}" if longest else "-"
        flag = " ⚠️" if s["select1_ms"] >= 500 else ""
        LOGGER.info(
            "  %-17s %7.1fms %6s %6s %7s %12s %9s%%  %s%s",
            ts.strftime("%m-%d %H:%M"), s["select1_ms"], s["connections"], s["active"],
            gap, dread, s.get("cache_hit_pct"), lon, flag,
        )
        prev = (ts, s["blks_read"])

    slow = [s for s in rows if s["select1_ms"] >= 500]
    LOGGER.info("  " + "-" * 96)
    LOGGER.info("  ⚠️ 印は素の `SELECT 1` が 500ms 以上かかった点（%s / %s）", len(slow), len(rows))
    LOGGER.info("     GitHub Actions から Supabase までの往復が 100〜130ms あるので、平常でもそのくらいは出る。")
    LOGGER.info("     **見るべきは絶対値ではなく «他の点と比べて飛んでいるか» である。**")
    return 0


if __name__ == "__main__":
    sys.exit(main())
